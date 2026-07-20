import os
import logging
import io
import zipfile
import re
import random
import urllib.parse
import requests
from typing import Optional, Dict, Any, List, Union
from functools import wraps
from dataclasses import dataclass, asdict
from enum import Enum
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, g, Response
from flask_cors import CORS
from dotenv import load_dotenv
from firebase_functions import https_fn
from google.cloud.firestore_v1.base_query import FieldFilter
import threading
import firebase_admin
from firebase_admin import credentials, firestore, storage as fb_storage

load_dotenv()

N8N_OTP_WEBHOOK = os.environ.get('N8N_OTP_WEBHOOK')

app = Flask(__name__)
CORS(app, origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5173",
    "https://prashantireturns.web.app",
    "https://prashantireturns.firebaseapp.com",
    "prashantireturns.firebaseapp.com",
    "prashantireturns.firebasestorage.app"
])

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==========================================================
# FIREBASE INITIALIZATION
# ==========================================================
db = None
bucket = None

try:
    fb_client_email = os.getenv("FB_CLIENT_EMAIL")
    fb_project_id = os.getenv("FB_PROJECT_ID")
    fb_private_key = os.getenv("FB_PRIVATE_KEY")
    storage_bucket_name = os.getenv("VITE_STORAGE_BUCKET")
    
    if fb_client_email and fb_project_id and fb_private_key:
        formatted_private_key = fb_private_key.replace('\\n', '\n')
        
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": fb_project_id,
            "private_key": formatted_private_key,
            "client_email": fb_client_email,
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        
        firebase_admin.initialize_app(cred, {
            'storageBucket': storage_bucket_name
        })
        
        db = firestore.client()
        bucket = fb_storage.bucket()
    else:
        logger.warning("⚠️ Firebase credentials missing in .env")
except Exception as e:
    logger.error(f"❌ Failed to initialize Firebase: {e}")

# ==========================================================
# SHOPIFY CONFIGURATION
# ==========================================================
SHOPIFY_STORE = os.environ.get('VITE_SHOPIFY_SHOP_DOMAIN')
SHOPIFY_ACCESS_TOKEN = os.environ.get('VITE_SHOPIFY_ACCESS_TOKEN')
SHOPIFY_API_VERSION = os.environ.get('VITE_SHOPIFY_API_VERSION')
SHOPIFY_BASE_URL = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}"
SHOPIFY_GRAPHQL_URL = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"

# ==========================================================
# SHARED HTTP SESSION
# Created ONCE per cold start and reused by every warm invocation on this
# instance, so the TCP/TLS connection to Shopify stays alive (keep-alive)
# instead of being renegotiated on every request.
# ==========================================================
shopify_session = requests.Session()
shopify_session.headers.update({
    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json'
})

# Webhook URLs
N8N_RETURN_APPLIED_WEBHOOK = os.environ.get('N8N_RETURN_APPLIED_WEBHOOK')
N8N_REJECTION_WEBHOOK = os.environ.get('N8N_REJECTION_WEBHOOK')
N8N_CLOSED_WEBHOOK = os.environ.get('N8N_CLOSED_WEBHOOK')
N8N_SELF_SHIP_WEBHOOK = os.environ.get('N8N_SELF_SHIP_WEBHOOK')
N8N_REFUND_DONE_WEBHOOK = os.environ.get('N8N_REFUND_DONE_WEBHOOK')
N8N_PICKUP_CREATED_WEBHOOK = os.environ.get('N8N_PICKUP_CREATED_WEBHOOK')
N8N_PICKUP_CANCELLED_WEBHOOK = os.environ.get('N8N_PICKUP_CANCELLED_WEBHOOK')
N8N_RETURN_RECEIVED_WEBHOOK = os.environ.get('N8N_RETURN_RECEIVED_WEBHOOK')
N8N_ITEM_REJECTION_WEBHOOK = os.environ.get('N8N_ITEM_REJECTION_WEBHOOK')

# ==========================================================
# API KEY AUTHENTICATION
# ==========================================================
def require_api_key(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # 1. ALWAYS allow preflight OPTIONS requests to pass through
        if request.method == 'OPTIONS':
            return f(*args, **kwargs)
            
        api_key = request.headers.get('X-API-Key')
        expected_key = os.getenv('VITE_FLASK_API_KEY')
        
        # Skip API key check for health and webhook endpoints
        if request.path in ['/health', '/webhook']:
            return f(*args, **kwargs)
        
        if not api_key or api_key != expected_key:
            logger.warning(f"Invalid API key attempt from {request.remote_addr}")
            return jsonify({'error': 'Invalid or missing API key'}), 401
        
        return f(*args, **kwargs)
    return decorated

# ==========================================================
# HELPER FUNCTIONS (From Original TypeScript)
# ==========================================================
def normalize_phone(phone):
    """Normalize phone number by removing non-digits and getting last 10 digits"""
    if not phone:
        return ''
    import re
    return re.sub(r'\D', '', phone)[-10:]

def verify_order_ownership(order, verification_input):
    """Verify if the verification input matches order email or phone"""
    verification_input = verification_input.strip().lower()
    
    # Check email
    order_email = (order.get('email') or '').lower()
    customer_email = (order.get('customer', {}).get('email') or '').lower()
    
    if order_email == verification_input or customer_email == verification_input:
        return True
    
    # Check phone
    import re
    is_phone_input = bool(re.match(r'^\d+$', re.sub(r'\D', '', verification_input)))
    
    if is_phone_input:
        input_phone = normalize_phone(verification_input)
        
        if len(input_phone) >= 10:
            order_phone = normalize_phone(order.get('phone'))
            customer_phone = normalize_phone(order.get('customer', {}).get('phone'))
            shipping_phone = normalize_phone(order.get('shipping_address', {}).get('phone'))
            
            return (input_phone in order_phone or 
                   input_phone in customer_phone or 
                   input_phone in shipping_phone)
    
    return False

def shopify_headers():
    """Return headers for Shopify API requests"""
    return {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
    }

def trigger_webhook(url, payload, log_context):
    """Send webhook notification asynchronously (fire-and-forget)"""
    def run_webhook():
        try:
            response = requests.post(url, json=payload, headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }, timeout=30)
            
            if response.ok:
                logger.info(f"✅ {log_context} webhook successful")
            else:
                logger.warning(f"⚠️ {log_context} webhook returned status: {response.status_code}")
        except Exception as e:
            logger.error(f"❌ Failed to send {log_context} notification: {str(e)}")

    # Start the request in a background thread so the UI doesn't wait
    thread = threading.Thread(target=run_webhook)
    thread.start()
    
    # Immediately return True to the frontend
    return True

def _is_allowed_download_host(hostname: Optional[str]) -> bool:
    """Restrict the download proxy to known-safe hosts (Shopify CDN, Firebase Storage)
    so this authenticated endpoint can't be abused as an open SSRF relay."""
    if not hostname:
        return False
    hostname = hostname.lower()
    allowed_suffixes = (
        'shopify.com', 'shopifycdn.com', 'myshopify.com',
        'firebasestorage.googleapis.com', 'storage.googleapis.com', 'firebasestorage.app',
    )
    return any(hostname == s or hostname.endswith('.' + s) for s in allowed_suffixes)


def _safe_filename(name: str, fallback: str = 'file') -> str:
    name = (name or '').strip()
    name = re.sub(r'[^A-Za-z0-9_.\-]', '_', name)
    return name or fallback


@app.route('/api/download/image', methods=['GET'])
@require_api_key
def download_image():
    """Proxy-download a single remote image (Shopify CDN / Firebase Storage).

    Browsers ignore the `download` attribute on cross-origin links, which is why the
    product-image button was opening a new tab instead of saving the file. Fetching
    the bytes server-to-server (no CORS involved) and returning them with
    Content-Disposition: attachment forces a real download.
    """
    try:
        image_url = request.args.get('url')
        filename = _safe_filename(request.args.get('filename', ''), 'image.jpg')

        if not image_url:
            return jsonify({'error': 'Missing url parameter'}), 400

        parsed = urllib.parse.urlparse(image_url)
        if parsed.scheme != 'https' or not _is_allowed_download_host(parsed.hostname):
            return jsonify({'error': 'This URL host is not allowed for download'}), 400

        upstream = requests.get(image_url, timeout=20)
        if upstream.status_code != 200:
            return jsonify({'error': f'Failed to fetch image (status {upstream.status_code})'}), 502

        return Response(
            upstream.content,
            mimetype=upstream.headers.get('Content-Type', 'application/octet-stream'),
            headers={'Content-Disposition': f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        logger.error(f"Error downloading image: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/download/images-zip', methods=['POST'])
@require_api_key
def download_images_zip():
    """Bundle multiple remote images (customer-uploaded return photos from Firebase
    Storage) into a single ZIP named after the order, fetched server-side to bypass
    the browser CORS restriction that blocks direct cross-origin downloads."""
    try:
        data = request.get_json() or {}
        images = data.get('images', [])
        zip_filename = _safe_filename(data.get('zipFilename', ''), 'images')

        if not images:
            return jsonify({'error': 'No images provided'}), 400

        mem_zip = io.BytesIO()
        used_names = set()
        fetched_count = 0

        with zipfile.ZipFile(mem_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
            for idx, img in enumerate(images):
                url = (img or {}).get('url')
                if not url:
                    continue

                parsed = urllib.parse.urlparse(url)
                if parsed.scheme != 'https' or not _is_allowed_download_host(parsed.hostname):
                    logger.warning(f"Skipping disallowed download host: {url}")
                    continue

                try:
                    upstream = requests.get(url, timeout=20)
                    if upstream.status_code != 200:
                        continue

                    name = _safe_filename(img.get('filename', ''), f'image_{idx + 1}.jpg')
                    base, ext = os.path.splitext(name)
                    final_name, counter = name, 1
                    while final_name in used_names:
                        final_name = f"{base}_{counter}{ext}"
                        counter += 1
                    used_names.add(final_name)

                    zf.writestr(final_name, upstream.content)
                    fetched_count += 1
                except Exception as inner_e:
                    logger.warning(f"Skipping image {url}: {inner_e}")
                    continue

        if fetched_count == 0:
            return jsonify({'error': 'Failed to fetch any of the requested images'}), 502

        mem_zip.seek(0)
        return Response(
            mem_zip.read(),
            mimetype='application/zip',
            headers={'Content-Disposition': f'attachment; filename="{zip_filename}.zip"'}
        )
    except Exception as e:
        logger.error(f"Error creating images zip: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
# ==========================================================
# REFUND CLASSES (From Your Provided Code)
# ==========================================================
class RefundMethod(Enum):
    """Enum for refund methods"""
    GIFT_CARD = "giftcard"
    STORE_CREDIT = "store_credit"
    ORIGINAL_PAYMENT = "original"
    MANUAL = "manual"


@dataclass
class RefundResult:
    """Data class for refund results"""
    success: bool
    refund_method: RefundMethod
    refund_id: Optional[str] = None
    transaction_id: Optional[str] = None
    amount: Optional[str] = None
    currency: Optional[str] = None
    customer_id: Optional[str] = None
    customer_email: Optional[str] = None
    gift_card_code: Optional[str] = None
    raw_response: Optional[Dict] = None
    error_message: Optional[str] = None
    transactions: Optional[List[Dict]] = None
    order_name: Optional[str] = None
    store_credit_transaction_id: Optional[str] = None
    account_balance: Optional[Dict] = None
    firebase_updated: bool = False
    firebase_error: Optional[str] = None


class ShopifyService:
    def __init__(self, shop_domain: str, access_token: str, api_version: str):
        self.shop_domain = shop_domain
        self.access_token = access_token
        self.api_version = api_version
        self.graphql_endpoint = f"https://{shop_domain}/admin/api/{api_version}/graphql.json"
        
        # Connection Pooling (Keeps the SSL connection warm)
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": self.access_token,
        })
        
        self._init_graphql_queries()
    
    def _init_graphql_queries(self):
        self.GET_ORDER_CUSTOMER = """
            query GetOrderCustomer($id: ID!) {
            order(id: $id) {
                id
                name
                email
                displayFinancialStatus
                totalPriceSet {
                shopMoney {
                    amount
                    currencyCode
                }
                }
                customer {
                id
                displayName
                email
                firstName
                lastName
                }
                lineItems(first: 50) {
                edges {
                    node {
                    id
                    title
                    quantity
                    sku
                    originalTotalSet {
                        shopMoney {
                        amount
                        currencyCode
                        }
                    }
                    taxLines {
                        priceSet {
                        shopMoney {
                            amount
                            currencyCode
                        }
                        }
                        rate
                        title
                    }
                    }
                }
                }
                paymentGatewayNames
                transactions(first: 10) {
                id
                gateway
                kind
                status
                amountSet {
                    shopMoney {
                    amount
                    currencyCode
                    }
                }
                }
            }
            }
            """
        
        self.GIFT_CARD_CREATE = """
        mutation GiftCardCreate($input: GiftCardCreateInput!) {
            giftCardCreate(input: $input) {
                giftCard {
                id
                createdAt
                note
                initialValue {
                    amount
                    currencyCode
                }
                customer {
                    id
                    email
                }
                }
                giftCardCode
                userErrors {
                field
                message
                }
            }
        }
        """
        
        self.REFUND_TO_ORIGINAL_PAYMENT_MUTATION = """
        mutation RefundToOriginalPayment($input: RefundInput!) {
          refundCreate(input: $input) {
            userErrors {
              field
              message
            }
            refund {
              id
              totalRefundedSet {
                presentmentMoney {
                  amount
                  currencyCode
                }
              }
              transactions(first: 5) {
                edges {
                  node {
                    id
                    gateway
                    kind
                    status
                    amountSet {
                      presentmentMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
            order {
              id
            }
          }
        }
        """
        
        self.STORE_CREDIT_ACCOUNT_CREDIT_MUTATION = """
        mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
          storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
            storeCreditAccountTransaction {
              id
              amount {
                amount
                currencyCode
              }
              account {
                id
                balance {
                  amount
                  currencyCode
                }
              }
            }
            userErrors {
              message
              field
            }
          }
        }
        """
    
    def _make_graphql_request(self, query: str, variables: Optional[Dict] = None) -> Dict:
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        
        try:
            response = self.session.post(
                self.graphql_endpoint,
                json=payload,
                timeout=15 
            )
            
            if response.status_code != 200:
                logger.error(f"Shopify HTTP Error {response.status_code}: {response.text}")
                response.raise_for_status()
                
            data = response.json()
            
            if "errors" in data:
                error_messages = [e.get("message", "Unknown error") for e in data["errors"]]
                logger.error(f"GraphQL errors: {error_messages}")
                raise Exception(f"GraphQL error: {', '.join(error_messages)}")
            
            return data.get("data", {})
            
        except requests.exceptions.Timeout:
            logger.error("Shopify GraphQL API timed out.")
            raise Exception("Shopify API timed out. Please try again.")
        except Exception as e:
            logger.error(f"Request failed: {str(e)}")
            raise

    def get_order_details(self, order_gid: str) -> Dict:
        try:
            result = self._make_graphql_request(
                self.GET_ORDER_CUSTOMER,
                variables={"id": order_gid}
            )
            
            if not result.get("order"):
                raise ValueError(f"Order not found: {order_gid}")
            
            return result["order"]
        except Exception as e:
            logger.error(f"Failed to fetch order details: {str(e)}")
            raise
    
    def create_gift_card(self, initial_value: Union[str, float], customer_id: Optional[str] = None, note: Optional[str] = None) -> Dict:
        if isinstance(initial_value, (int, float)):
            initial_value = f"{initial_value:.2f}"
        
        gift_card_input = {"initialValue": initial_value}
        
        if customer_id:
            gift_card_input["customerId"] = customer_id
        if note:
            gift_card_input["note"] = note

        try:
            result = self._make_graphql_request(
                self.GIFT_CARD_CREATE,
                variables={"input": gift_card_input}
            )
            
            gc_result = result.get("giftCardCreate", {})
            user_errors = gc_result.get("userErrors", [])
            
            if user_errors:
                error_messages = [e.get("message") for e in user_errors]
                raise Exception(f"Gift card creation failed: {', '.join(error_messages)}")
            
            gift_card = gc_result.get("giftCard", {})
            gift_card_code = gc_result.get("giftCardCode")
            if gift_card_code:
                gift_card["code"] = gift_card_code
            
            return gift_card
        except Exception as e:
            logger.error(f"Failed to create gift card: {str(e)}")
            raise
    
    def refund_to_original_payment(self, order_gid: str, refund_amount: Union[str, float], currency_code: str, 
                                   parent_transaction_id: str, gateway: str,
                                   notify: Optional[bool] = None, note: Optional[str] = None) -> Dict:
        if isinstance(refund_amount, (int, float)):
            refund_amount = f"{refund_amount:.2f}"
        
        refund_input: Dict[str, Any] = {
            "orderId": order_gid,
            "transactions": [
                {
                    "orderId": order_gid,
                    "parentId": parent_transaction_id,
                    "kind": "REFUND",
                    "gateway": gateway,
                    "amount": str(refund_amount), 
                }
            ],
            "notify": notify if notify is not None else True
        }
        
        if note:
            refund_input["note"] = note
        
        try:
            data = self._make_graphql_request(
                self.REFUND_TO_ORIGINAL_PAYMENT_MUTATION,
                variables={"input": refund_input}
            )
            
            result = data.get("refundCreate", {})
            user_errors = result.get("userErrors", [])
            
            if user_errors:
                error_messages = [f"{e.get('field', 'unknown')}: {e.get('message', '')}" for e in user_errors]
                raise Exception(f"Original payment refund failed: {', '.join(error_messages)}")
            
            return result.get("refund", {})
        except Exception as e:
            logger.error(f"Failed to create original payment refund: {str(e)}")
            raise
    
    def create_store_credit_account_credit(self, account_id: str, amount: Union[str, float], 
                                            currency_code: str, notify: bool = False) -> Dict:
        if isinstance(amount, (int, float)):
            amount = f"{amount:.2f}"
        
        credit_input = {
            "creditAmount": {
                "amount": amount,
                "currencyCode": currency_code
            }
        }
        
        try:
            data = self._make_graphql_request(
                self.STORE_CREDIT_ACCOUNT_CREDIT_MUTATION,
                variables={
                    "id": account_id,
                    "creditInput": credit_input
                }
            )
            
            result = data.get("storeCreditAccountCredit", {})
            user_errors = result.get("userErrors", [])
            
            if user_errors:
                error_messages = [f"{e.get('field', 'unknown')}: {e.get('message', '')}" for e in user_errors]
                raise Exception(f"Store credit account credit failed: {', '.join(error_messages)}")
            
            return result.get("storeCreditAccountTransaction", {})
        except Exception as e:
            logger.error(f"Failed to add store credit: {str(e)}")
            raise

    def cancel_shopify_order(self, order_id: str) -> bool:
        """Explicitly cancels the order in Shopify for Full Returns"""
        # Extract numeric ID if GID is passed
        numeric_id = order_id.split("/")[-1] if "gid://" in order_id else order_id
        cancel_url = f"https://{self.shop_domain}/admin/api/{self.api_version}/orders/{numeric_id}/cancel.json"
        
        try:
            # Sending an empty payload to the cancel endpoint cancels the order
            response = self.session.post(cancel_url, json={})
            if response.status_code == 200:
                logger.info(f"Successfully cancelled full return order: {numeric_id}")
                return True
            else:
                logger.warning(f"Failed to cancel order {numeric_id}: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Exception cancelling order {numeric_id}: {str(e)}")
            return False

    def update_firebase_with_refund(self, refund_result: RefundResult, metadata: Optional[Dict] = None) -> bool:
        """Update the Firestore return document after a successful refund.

        Resolves the target document by its Firestore doc ID (metadata['orderId']),
        falling back to a lookup by RAN (metadata['RAN']) if the direct ID doesn't
        match. Also handles Shopify Order Cancellation for Full Returns.
        """
        if not db:
            return False

        metadata = metadata or {}
        order_id = metadata.get('orderId')
        ran = metadata.get('RAN')
        agent_name = metadata.get('agentName', 'System')
        
        # 1. Extract Full/Partial return flag and determine expected statuses
        is_full_return = metadata.get('isFullReturn', False)
        return_type = "Full Return" if is_full_return else "Partial Return"
        expected_fulfillment = "Unfulfilled" if is_full_return else "Partially Fulfilled"

        if not order_id and not ran:
            logger.error("update_firebase_with_refund: no orderId or RAN in metadata — cannot locate return document")
            return False

        # 2. Trigger Condition 1: Cancel Order if Full Return
        # We do this before the Firebase update to ensure the Shopify API call succeeds
        if is_full_return and order_id:
            self.cancel_shopify_order(order_id)

        try:
            return_ref = None

            # Locate the document via order_id
            if order_id:
                candidate_ref = db.collection('returns').document(order_id)
                if candidate_ref.get().exists:
                    return_ref = candidate_ref

            # Fallback: Locate via RAN
            if return_ref is None and ran:
                docs = list(db.collection('returns').where('RAN', '==', ran).limit(1).stream())
                if docs:
                    return_ref = docs[0].reference

            if return_ref is None:
                logger.error(f"update_firebase_with_refund: no matching return document for orderId={order_id!r}, RAN={ran!r}")
                return False

            # 3. Append the new returnType and expectedFulfillment fields to refund details
            refund_details = {
                'method': refund_result.refund_method.value,
                'finalAmount': float(refund_result.amount) if refund_result.amount else 0,
                'shopifyRefundId': refund_result.refund_id or refund_result.transaction_id,
                'transactionId': refund_result.transaction_id,
                'giftCardCode': refund_result.gift_card_code,
                'transactions': refund_result.transactions,
                'shopifyResponse': refund_result.raw_response,
                'returnType': return_type,
                'expectedFulfillment': expected_fulfillment,
                'isFullReturn': is_full_return,
                'baseAmount': metadata.get('baseAmount', 0),
                'shippingRefundAddition': metadata.get('shippingRefundAddition', 0),
                'deductions': metadata.get('deductions', {}),
                'quantityMultiplied': metadata.get('quantityMultiplied', {})
            }

            update_data = {
                'refundStatus': 'Refunded',
                'status': 'completed',
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'refundDetails': refund_details,
                'refundMethod': refund_result.refund_method.value,
                'refundAmount': float(refund_result.amount) if refund_result.amount else 0,
                'refundCompletedAt': firestore.SERVER_TIMESTAMP,
                'shopifyRefundId': refund_result.refund_id,
                'returnType': return_type,  # Placed at root level for easy querying & Excel exports
            }

            if refund_result.gift_card_code:
                update_data['giftCardCode'] = refund_result.gift_card_code

            return_ref.update(update_data)

            # 4. Add an activity log entry noting the specific return type
            return_ref.collection('activities').add({
                'type': 'success',
                'title': 'Refund Issued',
                'description': f"Refund of ₹{float(refund_result.amount):.2f} issued via {refund_result.refund_method.value.replace('_', ' ')} ({return_type})",
                'timestamp': firestore.SERVER_TIMESTAMP,
                'user': agent_name,
                'metadata': refund_details
            })

            return True
        except Exception as e:
            logger.error(f"Firebase update failed for refund (orderId={order_id!r}, RAN={ran!r}): {str(e)}")
            return False
        
    def process_refund(self, order_gid: str, amount: Union[str, float], refund_method: RefundMethod, 
                       line_item_refunds: List[Dict], note: str, notify_customer: bool, metadata: Dict) -> RefundResult:
        """Centralized processor for non-original payment refunds (Store Credit & Gift Card)"""
        try:
            order_details = self.get_order_details(order_gid)
            
            # --- SAFE DATA EXTRACTION ---
            customer = order_details.get('customer') or {}
            customer_id = customer.get('id')
            customer_email = order_details.get('email') or customer.get('email')
            currency = order_details.get('totalPriceSet', {}).get('shopMoney', {}).get('currencyCode', 'INR')
            
            result_kwargs = {
                'success': True,
                'refund_method': refund_method,
                'amount': str(amount),
                'currency': currency,
                'customer_email': customer_email,
                'order_name': order_details.get('name')
            }

            if refund_method == RefundMethod.GIFT_CARD:
                if not customer_id:
                    raise ValueError("A customer ID is required to issue a Gift Card.")
                
                gc = self.create_gift_card(amount, customer_id, note)
                result_kwargs.update({
                    'gift_card_code': gc.get('code'),
                    'refund_id': gc.get('id')
                })
                
            elif refund_method == RefundMethod.STORE_CREDIT:
                if not customer_id:
                    raise ValueError("A customer ID is required to issue Store Credit.")
                
                # --- AUTO-CREATE FIX ---
                # Shopify automatically creates the store credit account if it doesn't exist
                # as long as we pass the customer_id directly into the credit mutation!
                transaction = self.create_store_credit_account_credit(
                    account_id=customer_id, 
                    amount=amount,
                    currency_code=currency,
                    notify=notify_customer
                )
                result_kwargs.update({
                    'store_credit_transaction_id': transaction.get('id'),
                    'account_balance': transaction.get('account', {}).get('balance')
                })
            else:
                raise ValueError(f"Unsupported custom refund method: {refund_method.value}")

            refund_result = RefundResult(**result_kwargs)
            firebase_updated = self.update_firebase_with_refund(refund_result, metadata)
            refund_result.firebase_updated = firebase_updated
            
            return refund_result
            
        except Exception as e:
            logger.error(f"Process refund failed: {str(e)}")
            return RefundResult(
                success=False, 
                refund_method=refund_method, 
                error_message=str(e)
            )
             
def get_shopify_service():
    """Get or create Shopify service instance"""
    shop_domain = os.getenv('VITE_SHOPIFY_SHOP_DOMAIN')
    access_token = os.getenv('VITE_SHOPIFY_ACCESS_TOKEN')
    api_version = os.getenv('VITE_SHOPIFY_API_VERSION')
    
    if not shop_domain or not access_token:
        raise ValueError("Shopify credentials not configured")
    
    return ShopifyService(shop_domain, access_token, api_version)


# ==========================================================
# BLUE DART CONFIGURATION
# ==========================================================
class BlueDartConfig:
    BLUEDART_TOKEN_URL = os.getenv("BLUEDART_TOKEN_URL")
    BLUEDART_WAYBILL_URL = os.getenv("BLUEDART_WAYBILL_URL")
    BLUEDART_CANCEL_WAYBILL_URL = os.getenv("BLUEDART_CANCEL_WAYBILL_URL")
    BLUEDART_CANCEL_PICKUP_URL = os.getenv("BLUEDART_CANCEL_PICKUP_URL")
    BLUEDART_TRACKING_URL = os.getenv("BLUEDART_TRACKING_URL")

    BD_CLIENT_ID = os.getenv("BD_CLIENT_ID")
    BD_CLIENT_SECRET = os.getenv("BD_CLIENT_SECRET")
    BD_LOGIN_ID = os.getenv("BD_LOGIN_ID")
    BD_LICENCE_KEY = os.getenv("BD_LICENCE_KEY")
    BD_TRACKING_LICENSE_KEY = os.getenv("BD_TRACKING_LICENSE_KEY") 
    BD_CUSTOMER_CODE = os.getenv("BD_CUSTOMER_CODE")
    
    REQUEST_TIMEOUT = 30


def get_bluedart_jwt():
    headers = {
        "ClientID": BlueDartConfig.BD_CLIENT_ID,
        "clientSecret": BlueDartConfig.BD_CLIENT_SECRET
    }
    try:
        response = requests.get(BlueDartConfig.BLUEDART_TOKEN_URL, headers=headers, timeout=BlueDartConfig.REQUEST_TIMEOUT)
        response.raise_for_status()
        token = response.json().get("JWTToken")
        if not token:
            raise ValueError("No JWT token in response")
        return token
    except Exception as e:
        logger.error(f"Failed to fetch JWT token: {e}")
        raise


def get_bluedart_auth_headers():
    return {
        "Content-Type": "application/json",
        "JWTToken": get_bluedart_jwt()
    }


def update_firebase_with_waybill(ran, awb_number, token_number, pickup_date, label_url, result, metadata=None):
    """Update Firebase with waybill details with agent attribution"""
    if not db:
        return False
    
    try:
        docs = list(db.collection("returns").where("RAN", "==", ran).limit(1).stream())
        if not docs:
            logger.warning(f"No return found for RAN {ran}")
            return False

        doc_ref = docs[0].reference
        
        # Get the agent name from metadata, falling back to 'System'
        agent_name = metadata.get('agentName') if metadata else 'System'
        
        clean_result = {k: v for k, v in result.items() if k != "AWBPrintContent"}
        
        doc_ref.collection("bluedart_waybills").document(awb_number).set({
            "awb": awb_number,
            "tokenNumber": token_number,
            "pickupDate": pickup_date,
            "labelUrl": label_url,
            "rawResponse": clean_result,
            "createdAt": firestore.SERVER_TIMESTAMP
        })

        update_data = {
            "awb": awb_number,
            "status": "Approved",
            "shipmentStatus": "Pickup Created",
            "refundStatus": "Pending",
            "pickupToken": token_number,
            "pickupDate": pickup_date,
            "shippingLabelUrl": label_url,
            "awbCreatedAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP
        }
        
        doc_ref.update(update_data)

        # Updated to use agent_name instead of hardcoded 'System'
        db.collection("returns").document(doc_ref.id).collection("activities").add({
            "type": "success",
            "title": "Pickup Created",
            "description": f"Return pickup scheduled. AWB: {awb_number}",
            "timestamp": firestore.SERVER_TIMESTAMP,
            "user": agent_name, 
            "metadata": {"awb": awb_number, "tokenNumber": token_number}
        })

        return True
    except Exception as e:
        logger.error(f"Firestore update failed: {str(e)}")
        return False
    
# ==========================================================
# ORIGINAL SHOPIFY PROXY ENDPOINTS
# ==========================================================
def get_delivery_date_by_name(order_name):
    """Fetch the delivery date of an order using Shopify GraphQL."""
    graphql_url = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"
    
    graphql_query = """
    query GetOrderByName($searchQuery: String!) {
      orders(first: 1, query: $searchQuery) {
        nodes {
          fulfillments(first: 50) {
            deliveredAt
          }
        }
      }
    }
    """
    variables = {"searchQuery": f"name:'{order_name}'"}
    
    try:
        response = requests.post(
            graphql_url, 
            headers=shopify_headers(), 
            json={"query": graphql_query, "variables": variables},
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            orders = data.get("data", {}).get("orders", {}).get("nodes", [])
            
            # Find the first fulfillment that has a deliveredAt date
            if orders and orders[0].get("fulfillments"):
                for fulfillment in orders[0]["fulfillments"]:
                    if fulfillment.get("deliveredAt"):
                        return fulfillment["deliveredAt"] # Return raw ISO string
    except Exception as e:
        logger.error(f"Failed to fetch delivery date for {order_name}: {e}")
        
    return None

# --- OPTIMIZED: single GraphQL round trip instead of REST search + a second GraphQL call ---
VERIFY_ORDER_QUERY = """
query VerifyOrderByName($searchQuery: String!) {
  orders(first: 1, query: $searchQuery) {
    nodes {
      legacyResourceId
      name
      email
      phone
      displayFulfillmentStatus
      displayFinancialStatus
      tags
      createdAt
      currencyCode
      totalPriceSet {
        shopMoney {
          amount
        }
      }
      customer {
        firstName
        lastName
        displayName
        email
        phone
      }
      shippingAddress {
        address1
        address2
        city
        province
        provinceCode
        zip
        country
        phone
        firstName
        lastName
      }
      fulfillments(first: 10) {
        deliveredAt
      }
      lineItems(first: 50) {
        nodes {
          id
          name
          quantity
          sku
          variant {
            title
          }
          originalUnitPriceSet {
            shopMoney {
              amount
            }
          }
          product {
            legacyResourceId
            tags
            featuredImage {
              url
            }
          }
        }
      }
    }
  }
}
"""


def _gid_to_numeric_id(gid: Optional[str]) -> Optional[int]:
    """gid://shopify/LineItem/123456789 -> 123456789 (LineItem has no legacyResourceId field)"""
    if not gid:
        return None
    try:
        return int(gid.rsplit('/', 1)[-1])
    except (ValueError, IndexError):
        return None


def fetch_order_by_name_graphql(order_name: str) -> Optional[Dict[str, Any]]:
    """
    Fetch everything the customer page needs (order, line items, product
    images/tags, delivery date, customer, shipping address) in ONE Shopify
    GraphQL request, then reshape it into the same REST-style dict the
    frontend already expects. This replaces the old REST search + second
    GraphQL call, cutting the Shopify round trips for this endpoint in half.
    """
    variables = {"searchQuery": f"name:'{order_name}'"}

    response = shopify_session.post(
        SHOPIFY_GRAPHQL_URL,
        json={"query": VERIFY_ORDER_QUERY, "variables": variables},
        timeout=10
    )
    response.raise_for_status()

    payload = response.json()
    if "errors" in payload:
        logger.error(f"GraphQL errors fetching order {order_name}: {payload['errors']}")
        raise RuntimeError("Shopify GraphQL error")

    nodes = payload.get("data", {}).get("orders", {}).get("nodes", [])
    node = next((o for o in nodes if o.get("name") == order_name), None)
    if not node:
        return None

    # --- delivery date ---
    delivered_at = None
    for fulfillment in node.get("fulfillments", []):
        if fulfillment.get("deliveredAt"):
            delivered_at = fulfillment["deliveredAt"]
            break

    # --- line items + product image/tags ---
    line_items = []
    product_details: Dict[str, Any] = {}
    for li in node.get("lineItems", {}).get("nodes", []):
        variant = li.get("variant") or {}
        product = li.get("product") or {}
        price = (li.get("originalUnitPriceSet") or {}).get("shopMoney", {}).get("amount", "0.00")

        legacy_product_id = product.get("legacyResourceId")
        line_items.append({
            "id": _gid_to_numeric_id(li.get("id")),
            "title": li.get("name"),
            "quantity": li.get("quantity"),
            "price": price,
            "sku": li.get("sku"),
            "variant_title": variant.get("title"),
            "product_id": legacy_product_id,
        })

        if legacy_product_id:
            product_details[str(legacy_product_id)] = {
                "image": (product.get("featuredImage") or {}).get("url"),
                "tags": product.get("tags", [])
            }

    # --- customer / shipping address (always dicts, never None, so
    #     verify_order_ownership's .get() chain below can't blow up) ---
    customer = node.get("customer") or {}
    shipping = node.get("shippingAddress") or {}

    return {
        "id": node.get("legacyResourceId"),
        "name": node.get("name"),
        "email": node.get("email"),
        "phone": node.get("phone"),
        "tags": ", ".join(node.get("tags") or []),
        "currency": node.get("currencyCode"),
        "total_price": (node.get("totalPriceSet") or {}).get("shopMoney", {}).get("amount"),
        "created_at": node.get("createdAt"),
        "delivered_at": delivered_at,
        "financial_status": (node.get("displayFinancialStatus") or "").lower(),
        "fulfillment_status": (node.get("displayFulfillmentStatus") or "").lower(),
        "line_items": line_items,
        "customer": {
            "first_name": customer.get("firstName"),
            "last_name": customer.get("lastName"),
            "name": customer.get("displayName"),
            "email": customer.get("email"),
            "phone": customer.get("phone"),
        },
        "shipping_address": {
            "address1": shipping.get("address1"),
            "address2": shipping.get("address2"),
            "city": shipping.get("city"),
            "province": shipping.get("province"),
            "province_code": shipping.get("provinceCode"),
            "zip": shipping.get("zip"),
            "country": shipping.get("country"),
            "phone": shipping.get("phone"),
            "first_name": shipping.get("firstName"),
            "last_name": shipping.get("lastName"),
        },
        "product_details": product_details,
    }


@app.route('/api/orders/verify', methods=['POST'])
@require_api_key
def verify_order():
    """Verify order by name and customer identifier — single GraphQL round trip"""
    try:
        data = request.get_json()
        order_name = data.get('orderName')
        verification_input = data.get('verificationInput')
        
        if not order_name or not verification_input:
            return jsonify({'error': 'Missing required fields'}), 400
        
        matched_order = fetch_order_by_name_graphql(order_name)

        if not matched_order or matched_order.get('fulfillment_status') != 'fulfilled':
            return jsonify({'error': 'Order not found or not fulfilled'}), 404
        
        if verify_order_ownership(matched_order, verification_input):
            return jsonify({'order': matched_order})
        else:
            return jsonify({'error': 'Verification failed'}), 403
            
    except Exception as e:
        logger.error(f"Error verifying order: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/orders/<int:order_id>/order-note', methods=['POST'])
@require_api_key
def update_order_note(order_id):
    """
    Shopify API does not support native Timeline comments for apps via REST.
    Workaround: Overwrite the note to trigger a clean timeline event, 
    then immediately revert it to preserve original customer instructions.
    """
    try:
        data = request.get_json()
        event_title = data.get('eventTitle', 'Update')
        message = data.get('message', '')
        ran = data.get('ran', 'Unknown')

        # 1. Fetch the existing order to get the original customer note
        response = shopify_session.get(f"{SHOPIFY_BASE_URL}/orders/{order_id}.json", timeout=10)
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order'}), 500
        
        order_data = response.json().get('order', {})
        original_note = order_data.get('note') or ""
        
        # 2. Format the clean message we want to inject into the timeline
        timeline_message = f"📦 [RAN: {ran}] {event_title}\n{message}"
        
        shopify_session.put(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}.json",
            json={"order": {"id": order_id, "note": timeline_message}},
            timeout=10
        )
        
        update_res = shopify_session.put(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}.json",
            json={"order": {"id": order_id, "note": original_note}},
            timeout=10
        )
        
        if update_res.status_code == 200:
            return jsonify({'success': True})
            
        return jsonify({'error': 'Failed to revert Shopify note'}), 500
    except Exception as e:
        logger.error(f"Error updating note: {str(e)}")
        return jsonify({'error': str(e)}), 500
     
@app.route('/api/orders/customer', methods=['POST'])
@require_api_key
def fetch_customer_orders():
    """Fetch orders by customer identifier"""
    try:
        data = request.get_json()
        identifier = data.get('identifier')
        
        if not identifier:
            return jsonify({'error': 'Missing identifier'}), 400
        
        identifier = identifier.strip()
        is_email = '@' in identifier
        
        fetch_params = {
            'status': 'any',
            'limit': 250,
            # ADDED: shipping_lines to fields
            'fields': 'id,name,email,phone,customer,line_items,fulfillment_status,created_at,shipping_address,tags,currency,order_number,total_price,shipping_lines'
        }
        
        if is_email:
            fetch_params['email'] = identifier
        else:
            import re
            clean_phone = re.sub(r'\D', '', identifier)
            customer_response = requests.get(
                f"{SHOPIFY_BASE_URL}/customers/search.json",
                headers=shopify_headers(),
                params={'query': f'phone:*{clean_phone}*'},
                timeout=10
            )
            
            if customer_response.status_code != 200:
                return jsonify({'error': 'Failed to search customers'}), 500
            
            customers = customer_response.json().get('customers', [])
            if not customers:
                return jsonify({'orders': []})
            
            fetch_params['customer_id'] = customers[0]['id']
        
        response = requests.get(
            f"{SHOPIFY_BASE_URL}/orders.json",
            headers=shopify_headers(),
            params=fetch_params,
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch orders'}), 500
        
        all_orders = response.json().get('orders', [])
        
        filtered_orders = [
            order for order in all_orders
            if order.get('fulfillment_status') == 'fulfilled' 
            and verify_order_ownership(order, identifier)
        ]
        
        return jsonify({'orders': filtered_orders})
        
    except Exception as e:
        logger.error(f"Error fetching customer orders: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/orders/<order_name>', methods=['GET'])
@require_api_key
def get_shopify_order(order_name):
    """Fetch Shopify order by name"""
    try:
        params = {'name': order_name, 'status': 'any'}
        
        response = requests.get(
            f"{SHOPIFY_BASE_URL}/orders.json",
            headers=shopify_headers(),
            params=params,
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order'}), 500
        
        orders = response.json().get('orders', [])
        order = next((o for o in orders if o.get('name') == order_name), None)
        
        if not order:
            return jsonify({'error': 'Order not found'}), 404
        
        return jsonify({'order': order})
        
    except Exception as e:
        logger.error(f"Error fetching order: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/products/<int:product_id>', methods=['GET'])
@require_api_key
def get_product_details(product_id):
    """Fetch product details by ID"""
    try:
        response = requests.get(
            f"{SHOPIFY_BASE_URL}/products/{product_id}.json",
            headers=shopify_headers(),
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({'image': None, 'tags': []})
        
        product = response.json().get('product', {})
        
        tags = product.get('tags', [])
        if isinstance(tags, str):
            tags = [t.strip().lower() for t in tags.split(',')]
        elif isinstance(tags, list):
            tags = [t.strip().lower() for t in tags]
        else:
            tags = []
        
        return jsonify({
            'image': product.get('image', {}).get('src'),
            'tags': tags
        })
        
    except Exception as e:
        logger.error(f"Error fetching product details: {str(e)}")
        return jsonify({'image': None, 'tags': []}), 500

@app.route("/api/bluedart/serviceability", methods=["POST"])
@require_api_key
def check_serviceability():
    """Check if an array of pincodes are serviceable by Blue Dart using Firebase caching"""
    try:
        data = request.get_json()
        pincodes = data.get('pincodes', [])
        
        if not pincodes:
            return jsonify({"success": True, "results": {}})

        # Deduplicate and clean pincodes
        pincodes = list(set(str(pin).strip() for pin in pincodes if pin))
        results = {}
        pincodes_to_fetch = []

        # 1. Check Firebase Cache First
        if db:
            try:
                for pin in pincodes:
                    doc_ref = db.collection("bluedart_pincodes").document(pin)
                    doc_snap = doc_ref.get()
                    if doc_snap.exists:
                        cached_data = doc_snap.to_dict()
                        results[pin] = cached_data.get('is_serviceable', False)
                    else:
                        pincodes_to_fetch.append(pin)
            except Exception as e:
                logger.error(f"Error reading from Firebase cache: {e}")
                pincodes_to_fetch = pincodes  # Fallback to fetch all if DB read fails
        else:
            pincodes_to_fetch = pincodes

        # 2. Fetch missing pincodes from Blue Dart API
        if pincodes_to_fetch:
            headers = get_bluedart_auth_headers()
            SERVICE_URL = os.getenv("BLUEDART_SERVICE_URL")
            VERSION = os.getenv("BD_VERSION")
            
            for pin in pincodes_to_fetch:
                payload = {
                    "pinCode": pin,
                    "profile": {
                        "Api_type": "S",
                        "LicenceKey": BlueDartConfig.BD_LICENCE_KEY,
                        "LoginID": BlueDartConfig.BD_LOGIN_ID,
                        "Version": VERSION  
                    }
                }
                
                is_serviceable = False
                try:
                    response = requests.post(SERVICE_URL, json=payload, headers=headers, timeout=10)
                    if response.status_code == 200:
                        resp_data = response.json()
                        result = resp_data.get("GetServicesforPincodeResult", {})
                        
                        is_error = result.get("IsError", True)
                        error_message = result.get("ErrorMessage", "")
                        
                        is_serviceable = (not is_error) and (error_message.lower() == "valid")
                    else:
                        logger.warning(f"Blue Dart API failed for pincode {pin} with status {response.status_code}")
                except Exception as e:
                    logger.error(f"Error checking pincode {pin}: {e}")
                
                results[pin] = is_serviceable
                
                # 3. Save new result to Firebase Cache
                if db:
                    try:
                        db.collection("bluedart_pincodes").document(pin).set({
                            "pincode": pin,
                            "is_serviceable": is_serviceable,
                            "updatedAt": firestore.SERVER_TIMESTAMP
                        })
                    except Exception as e:
                        logger.error(f"Error saving to Firebase cache: {e}")

        return jsonify({"success": True, "results": results})

    except Exception as e:
        logger.error(f"Serviceability error: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
    
@app.route('/api/orders/<int:order_id>/restock', methods=['POST'])
@require_api_key
def restock_items(order_id):
    """Restock items back into Shopify Inventory reliably"""
    try:
        data = request.get_json()
        items = data.get('items', [])
        # Extract the agent name and RAN for logging purposes
        agent_name = data.get('agentName', 'System') 
        ran = data.get('RAN')
        
        if not items:
            return jsonify({'message': 'No items to restock'}), 200
            
        headers = shopify_headers()

        # STEP 1: Fetch the order to get Currency and Location ID
        order_response = requests.get(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}.json",
            headers=headers,
            timeout=10
        )
        
        if order_response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order details from Shopify'}), 500
            
        order_json = order_response.json().get('order', {})
        fulfillments_rest = order_json.get('fulfillments', [])
        
        location_id = None
        
        # Attempt 1: Get location from the order's fulfillment
        if fulfillments_rest:
            for f in fulfillments_rest:
                if f.get('location_id'):
                    location_id = f.get('location_id')
                    break
                    
        # Attempt 2: Fallback to the store's primary location
        if not location_id:
            loc_res = requests.get(f"{SHOPIFY_BASE_URL}/locations.json", headers=headers, timeout=10)
            if loc_res.status_code == 200:
                locations = loc_res.json().get('locations', [])
                if locations:
                    location_id = locations[0]['id']
                    
        if not location_id:
            return jsonify({'error': 'Could not determine a valid Location ID for restocking'}), 400

        # STEP 2: Build the Restock Payload
        # We process a $0.00 refund specifically to trigger the inventory restock
        refund_line_items = [
            {
                'line_item_id': item.get('lineItemId'),
                'quantity': item.get('quantityReturned'),
                'restock_type': 'return',
                'location_id': location_id
            }
            for item in items
        ]
        
        payload = {
            'refund': {
                'currency': order_json.get('currency'),
                'notify': False,
                'refund_line_items': refund_line_items,
                'transactions': [] # Empty array ensures NO money is moved, ONLY inventory is adjusted
            }
        }
        
        # STEP 3: Execute Restock
        response = requests.post(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}/refunds.json",
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code in [200, 201]:
            # Log the successful restock event to Firestore
            if db and ran:
                docs = list(db.collection("returns").where("RAN", "==", ran).limit(1).stream())
                if docs:
                    doc_ref = docs[0].reference
                    db.collection("returns").document(doc_ref.id).collection("activities").add({
                        "type": "success",
                        "title": "Items Restocked",
                        "description": f"{len(items)} item(s) restocked in inventory",
                        "timestamp": firestore.SERVER_TIMESTAMP,
                        "user": agent_name,
                        "metadata": {"items": items, "location_id": location_id}
                    })
            return jsonify({'success': True})
        else:
            # Safely capture exact Shopify error for easier debugging
            error_details = response.json()
            logger.error(f"Shopify Restock Failed: {error_details}")
            return jsonify({'error': f"Shopify rejected restock: {error_details}"}), response.status_code
            
    except Exception as e:
        logger.error(f"Error restock_items: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
# ==========================================================
# WEBHOOK PROXY ENDPOINTS (Forward to n8n)
# ==========================================================
@app.route('/api/webhooks/return-applied', methods=['POST'])
@require_api_key
def return_applied():
    """Forward return submission to n8n"""
    try:
        return_data = request.get_json()
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod')),
            'requestedMethodFormatted': format_refund_method(return_data.get('requestedMethod'))
        }
        
        success = trigger_webhook(N8N_RETURN_APPLIED_WEBHOOK, payload, "return-applied")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in return-applied webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/webhooks/return-rejection', methods=['POST'])
@require_api_key
def return_rejection():
    """Forward return rejection to n8n"""
    try:
        data = request.get_json()
        return_data = data.get('returnData')
        reason = data.get('reason')
        allow_resubmit = data.get('allowResubmit', False)
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        webhook_url = N8N_CLOSED_WEBHOOK if allow_resubmit else N8N_REJECTION_WEBHOOK
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod')),
            'rejectionReason': reason,
            'allowResubmit': allow_resubmit,
            'status': 'Closed' if allow_resubmit else 'Denied',
            'notificationType': 'closed' if allow_resubmit else 'denied',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(webhook_url, payload, "return-closed" if allow_resubmit else "return-rejected")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in return-rejection webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/webhooks/self-ship', methods=['POST'])
@require_api_key
def self_ship():
    """Forward self-ship request to n8n"""
    try:
        data = request.get_json()
        return_data = data.get('returnData')
        self_ship_details = data.get('selfShipDetails')
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod')),
            'selfShipDetails': self_ship_details,
            'notificationType': 'self_ship_requested',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_SELF_SHIP_WEBHOOK, payload, "self-ship")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in self-ship webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/webhooks/refund-done', methods=['POST'])
@require_api_key
def refund_done():
    """Forward refund completion to n8n"""
    try:
        data = request.get_json()
        return_data = data.get('returnData')
        refund_details = data.get('refundDetails')
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod')),
            'refundDetails': {
                **refund_details,
                'methodDisplay': format_refund_method(refund_details.get('method'))
            },
            'notificationType': 'refund_done',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_REFUND_DONE_WEBHOOK, payload, "refund-done")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in refund-done webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/webhooks/pickup-created', methods=['POST'])
@require_api_key
def pickup_created():
    """Forward pickup creation to n8n"""
    try:
        data = request.get_json()
        return_data = data.get('returnData')
        pickup_details = data.get('pickupDetails')
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod', '')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod', '')),
            'pickupDetails': pickup_details,
            'notificationType': 'pickup_created',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_PICKUP_CREATED_WEBHOOK, payload, "pickup-created")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in pickup-created webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/webhooks/pickup-cancelled', methods=['POST'])
@require_api_key
def pickup_cancelled():
    """Forward pickup cancellation to n8n"""
    try:
        data = request.get_json()
        return_data = data.get('returnData')
        cancellation_details = data.get('cancellationDetails')
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Unknown')
        
        def get_refund_method_details(method):
            details = {
                'store_credit': {'displayName': 'Store Credit', 'description': 'Credit will be added to your store account'},
                'gift_card': {'displayName': 'Gift Card', 'description': 'Digital gift card will be sent to your email'},
                'refund': {'displayName': 'Original Payment Method', 'description': 'Refund will be processed to your original payment method'}
            }
            return details.get(method, {'displayName': method or 'Unknown', 'description': ''})
        
        payload = {
            **return_data,
            'refundMethodDisplay': format_refund_method(return_data.get('requestedMethod', '')),
            'refundMethodDetails': get_refund_method_details(return_data.get('requestedMethod', '')),
            'cancellationDetails': cancellation_details,
            'notificationType': 'pickup_cancelled',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_PICKUP_CANCELLED_WEBHOOK, payload, "pickup-cancelled")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in pickup-cancelled webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500


# ==========================================================
# REFUND ENDPOINTS
# ==========================================================
@app.route('/api/refund/gift-card', methods=['POST'])
@require_api_key
def refund_gift_card():
    """Process refund as gift card"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['orderId', 'amount', 'lineItems']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        shopify_service = get_shopify_service()
        order_gid = data.get('shopifyOrderId') or f"gid://shopify/Order/{data['orderId']}"
        
        # Merge in orderId/RAN so update_firebase_with_refund can always locate the
        # return document, even if the caller only nested agentName under metadata.
        metadata = dict(data.get('metadata', {}))
        metadata.setdefault('orderId', data['orderId'])
        metadata.setdefault('RAN', data.get('RAN'))
        
        result = shopify_service.process_refund(
            order_gid=order_gid,
            amount=data['amount'],
            refund_method=RefundMethod.GIFT_CARD,
            line_item_refunds=data['lineItems'],
            note=data.get('note', f"Gift card refund for order {data['orderId']}"),
            notify_customer=data.get('notifyCustomer', True),
            metadata=metadata
        )
        
        if result.success:
            return jsonify({
                'success': True,
                'refundMethod': result.refund_method.value,
                'refundId': result.refund_id,
                'amount': result.amount,
                'currency': result.currency,
                'giftCardCode': result.gift_card_code,
                'customerEmail': result.customer_email,
                'orderName': result.order_name,
                'firebaseUpdated': result.firebase_updated
            }), 200
        else:
            return jsonify({
                'success': False,
                'errorMessage': result.error_message,
                'refundMethod': result.refund_method.value
            }), 400
    except Exception as e:
        logger.error(f"Error in gift card refund: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/refund/store-credit', methods=['POST'])
@require_api_key
def refund_store_credit():
    """Process refund as store credit"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['orderId', 'amount', 'lineItems']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        shopify_service = get_shopify_service()
        order_gid = data.get('shopifyOrderId') or f"gid://shopify/Order/{data['orderId']}"
        
        # Merge in orderId/RAN so update_firebase_with_refund can always locate the
        # return document, even if the caller only nested agentName under metadata.
        metadata = dict(data.get('metadata', {}))
        metadata.setdefault('orderId', data['orderId'])
        metadata.setdefault('RAN', data.get('RAN'))
        
        result = shopify_service.process_refund(
            order_gid=order_gid,
            amount=data['amount'],
            refund_method=RefundMethod.STORE_CREDIT,
            line_item_refunds=data['lineItems'],
            note=data.get('note', f"Store credit refund for order {data['orderId']}"),
            notify_customer=data.get('notifyCustomer', True),
            metadata=metadata
        )
        
        if result.success:
            response_data = {
                'success': True,
                'refundMethod': result.refund_method.value,
                'refundId': result.refund_id,
                'storeCreditTransactionId': result.store_credit_transaction_id,
                'amount': result.amount,
                'currency': result.currency,
                'customerEmail': result.customer_email,
                'accountBalance': result.account_balance,
                'orderName': result.order_name,
                'firebaseUpdated': result.firebase_updated
            }
            return jsonify(response_data), 200
        else:
            return jsonify({
                'success': False,
                'errorMessage': result.error_message,
                'refundMethod': result.refund_method.value
            }), 400
    except Exception as e:
        logger.error(f"Error in store credit refund: {str(e)}")
        return jsonify({'error': str(e)}), 500
     
@app.route('/api/refund/original-payment', methods=['POST'])
@require_api_key
def refund_original_payment():
    """Process refund to original payment method"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['orderId', 'amount']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        shopify_service = get_shopify_service()
        order_gid = data.get('shopifyOrderId') or f"gid://shopify/Order/{data['orderId']}"
        
        order_details = shopify_service.get_order_details(order_gid)
        currency_code = order_details.get('totalPriceSet', {}).get('shopMoney', {}).get('currencyCode', 'INR')
        
        raw_transactions = order_details.get('transactions', [])
        if isinstance(raw_transactions, dict):
            transactions_list = [edge.get('node', {}) for edge in raw_transactions.get('edges', [])]
        else:
            transactions_list = raw_transactions
            
        parent_transaction = next(
            (t for t in transactions_list if isinstance(t, dict) and t.get('kind') in ['SALE', 'CAPTURE'] and t.get('status') == 'SUCCESS'),
            None
        )
        
        if not parent_transaction:
            return jsonify({'error': 'No original successful payment found to refund against on Shopify'}), 400

        refund = shopify_service.refund_to_original_payment(
            order_gid=order_gid,
            refund_amount=data['amount'],
            currency_code=currency_code,
            parent_transaction_id=parent_transaction['id'],
            gateway=parent_transaction['gateway'],
            note=data.get('note'),
            notify=data.get('notifyCustomer', True)
        )
        
        refund_edges = refund.get('transactions', {}).get('edges', [])
        first_transaction = refund_edges[0].get('node', {}) if refund_edges else {}
        
        refund_result = RefundResult(
            success=True,
            refund_method=RefundMethod.ORIGINAL_PAYMENT,
            refund_id=refund.get('id'),
            transaction_id=first_transaction.get('id'),
            amount=data['amount'],
            currency=currency_code,
            customer_email=order_details.get('email'),
            transactions=[edge.get('node') for edge in refund_edges],
            order_name=order_details.get('name')
        )
        
        # Merge in orderId/RAN so update_firebase_with_refund can always locate the
        # return document, even if the caller only nested agentName under metadata.
        metadata = dict(data.get('metadata', {}))
        metadata.setdefault('orderId', data['orderId'])
        metadata.setdefault('RAN', data.get('RAN'))
        firebase_updated = shopify_service.update_firebase_with_refund(refund_result, metadata)
        
        return jsonify({
            'success': True,
            'refundMethod': refund_result.refund_method.value,
            'refundId': refund_result.refund_id,
            'transactionId': refund_result.transaction_id,
            'amount': refund_result.amount,
            'currency': refund_result.currency,
            'customerEmail': refund_result.customer_email,
            'transactions': refund_result.transactions,
            'orderName': refund_result.order_name,
            'firebaseUpdated': firebase_updated
        }), 200

    except Exception as e:
        logger.error(f"Error in original payment refund: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/refund/manual', methods=['POST'])
@require_api_key
def refund_manual():
    """Mark refund as manually processed with proper agent attribution"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['orderId', 'amount']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # 👇 FIX: Extract agentName correctly from the nested metadata object 👇
        metadata = data.get('metadata', {})
        agent_name = metadata.get('agentName', 'System')
        
        manual_refund_id = f"manual_{data['orderId']}_{int(datetime.now().timestamp())}"
        
        firebase_updated = False
        if db:
            try:
                return_ref = db.collection('returns').document(data['orderId'])
                return_doc = return_ref.get()
                
                if return_doc.exists:
                    update_data = {
                        'refundStatus': 'Refunded',
                        'status': 'completed',
                        'updatedAt': firestore.SERVER_TIMESTAMP,
                        'refundMethod': 'manual',
                        'refundAmount': float(data['amount']),
                        'refundCompletedAt': firestore.SERVER_TIMESTAMP,
                        'refundDetails': {
                            'method': 'manual',
                            'finalAmount': float(data['amount']),
                            'note': data.get('note', 'Manual refund processed'),
                            'baseAmount': metadata.get('baseAmount', 0),
                            'shippingRefundAddition': metadata.get('shippingRefundAddition', 0),
                            'deductions': metadata.get('deductions', {}),
                            'quantityMultiplied': metadata.get('quantityMultiplied', {})
                        }
                    }
                    
                    return_ref.update(update_data)
                    
                    activities_ref = db.collection('returns').document(data['orderId']).collection('activities')
                    activities_ref.add({
                        'type': 'success',
                        'title': 'Refund Issued',
                        'description': f"Refund of ₹{float(data['amount']):.2f} marked as manually processed",
                        'timestamp': firestore.SERVER_TIMESTAMP,
                        'user': agent_name,  # ✅ Now correctly attributed
                        'metadata': {
                            'refundMethod': 'manual',
                            'amount': float(data['amount']),
                            'refundId': manual_refund_id
                        }
                    })
                    
                    firebase_updated = True
            except Exception as e:
                logger.error(f"Firebase update failed for manual refund: {e}")
        
        return jsonify({
            'success': True,
            'refundMethod': 'manual',
            'refundId': manual_refund_id,
            'amount': data['amount'],
            'orderName': data.get('orderId'),
            'firebaseUpdated': firebase_updated
        }), 200
    except Exception as e:
        logger.error(f"Error in manual refund: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/products/<int:product_id>/variants', methods=['GET'])
@require_api_key
def get_product_variants(product_id):
    """
    Fetch full product data including all variants, options, and images.
    Used by the Exchange Modal to show available replacement variants.
    
    Returns:
        product.variants     — all variants with price, SKU, inventory, options
        product.options      — option groups e.g. [{ name: "Color", values: ["Red","Blue"] }]
        product.images       — images with variant_ids for variant-specific images
    """
    try:
        response = requests.get(
            f"{SHOPIFY_BASE_URL}/products/{product_id}.json",
            headers=shopify_headers(),
            params={
                'fields': 'id,title,handle,product_type,tags,status,variants,options,images'
            },
            timeout=10
        )
 
        if response.status_code == 404:
            return jsonify({'error': 'Product not found'}), 404
 
        if response.status_code != 200:
            logger.error(f"Shopify returned {response.status_code} for product {product_id}")
            return jsonify({'error': 'Failed to fetch product from Shopify'}), 500
 
        product = response.json().get('product', {})
        if not product:
            return jsonify({'error': 'Product not found'}), 404
 
        # Process variants — add an `available` flag based on inventory
        variants = []
        for v in product.get('variants', []):
            inventory_qty = v.get('inventory_quantity', 0)
            inventory_policy = v.get('inventory_policy', 'deny')
 
            # `continue` policy means sell even when out of stock
            available = inventory_qty > 0 or inventory_policy == 'continue'
 
            variants.append({
                'id':                  v.get('id'),
                'title':               v.get('title'),
                'sku':                 v.get('sku') or '',
                'price':               v.get('price'),
                'compare_at_price':    v.get('compare_at_price'),
                'inventory_quantity':  inventory_qty,
                'inventory_policy':    inventory_policy,
                'available':           available,
                'option1':             v.get('option1'),
                'option2':             v.get('option2'),
                'option3':             v.get('option3'),
                'image_id':            v.get('image_id'),
                'weight':              v.get('weight'),
                'weight_unit':         v.get('weight_unit'),
            })
 
        # Process images
        images = []
        for img in product.get('images', []):
            images.append({
                'id':          img.get('id'),
                'src':         img.get('src'),
                'alt':         img.get('alt'),
                'variant_ids': img.get('variant_ids', []),
                'position':    img.get('position', 0),
            })
 
        # Sort images: variant-specific first, then general
        images.sort(key=lambda x: (len(x['variant_ids']) == 0, x['position']))
 
        return jsonify({
            'product': {
                'id':           product.get('id'),
                'title':        product.get('title'),
                'handle':       product.get('handle'),
                'product_type': product.get('product_type'),
                'tags':         product.get('tags'),
                'status':       product.get('status'),
                'variants':     variants,
                'options':      product.get('options', []),
                'images':       images,
            }
        })
 
    except requests.Timeout:
        logger.error(f"Timeout fetching product variants for {product_id}")
        return jsonify({'error': 'Request timed out'}), 504
 
    except Exception as e:
        logger.error(f"Error fetching product variants for {product_id}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/orders/<int:order_id>/tags', methods=['POST'])
@require_api_key
def add_order_tag(order_id):
    """
    Safely appends a tag to a Shopify order without overwriting existing tags.
    """
    try:
        data = request.get_json()
        new_tag = data.get('tag')
        
        if not new_tag:
            return jsonify({'error': 'Tag is required'}), 400

        # 1. Fetch the existing order to get the current tags
        response = shopify_session.get(f"{SHOPIFY_BASE_URL}/orders/{order_id}.json", timeout=10)
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order from Shopify'}), 500
        
        order_data = response.json().get('order', {})
        current_tags = order_data.get('tags', '')
        
        # 2. Convert comma-separated string to a list and clean whitespace
        tags_list = [t.strip() for t in current_tags.split(',')] if current_tags else []
        
        # 3. Only add the tag if it doesn't already exist
        if new_tag not in tags_list:
            tags_list.append(new_tag)
            updated_tags_string = ", ".join(tags_list)
            
            # 4. Push the combined tags back to Shopify
            update_res = shopify_session.put(
                f"{SHOPIFY_BASE_URL}/orders/{order_id}.json",
                json={"order": {"id": order_id, "tags": updated_tags_string}},
                timeout=10
            )
            
            if update_res.status_code == 200:
                return jsonify({'success': True, 'tags': updated_tags_string})
            return jsonify({'error': 'Failed to update Shopify tags'}), 500
            
        return jsonify({'success': True, 'message': 'Tag already exists'})
    except Exception as e:
        logger.error(f"Error updating tags: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/products/by-sku/<path:sku>/variants', methods=['GET', 'OPTIONS'])
@require_api_key
def get_product_variants_by_sku(sku):
    """
    Look up a product by exact variant SKU using GraphQL, then return full
    variant/option/image data. Used as fallback when productId is not stored.
 
    Uses GraphQL productVariants query which does exact SKU matching —
    unlike the REST /variants.json endpoint which does prefix matching.
    """
    try:
        clean_sku = sku.strip()
 
        graphql_url = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"
 
        # Step 1: Use GraphQL to find exact SKU match and get product_id
        query = """
        query FindVariantBySKU($sku: String!) {
          productVariants(first: 5, query: $sku) {
            edges {
              node {
                id
                sku
                product {
                  id
                  legacyResourceId
                }
              }
            }
          }
        }
        """
 
        gql_response = requests.post(
            graphql_url,
            headers=shopify_headers(),
            json={"query": query, "variables": {"sku": f"sku:{clean_sku}"}},
            timeout=10
        )
 
        if gql_response.status_code != 200:
            logger.error(f"GraphQL error: {gql_response.status_code}")
            return jsonify({'error': 'Failed to search Shopify for SKU'}), 500
 
        gql_data = gql_response.json()
        edges = gql_data.get('data', {}).get('productVariants', {}).get('edges', [])
 
        if not edges:
            return jsonify({'error': f'No product found with SKU: {clean_sku}'}), 404
 
        # Exact match from results
        exact = next(
            (e['node'] for e in edges if e['node'].get('sku', '').strip() == clean_sku),
            None
        )
        if not exact:
            logger.warning(f"GraphQL returned variants but none match SKU exactly: {clean_sku}")
            logger.warning(f"Got: {[e['node'].get('sku') for e in edges]}")
            # Fall back to first result
            exact = edges[0]['node']
 
        product_id = exact['product']['legacyResourceId']
 
        # Step 2: Fetch full product via REST (same as productId endpoint)
        product_response = requests.get(
            f"{SHOPIFY_BASE_URL}/products/{product_id}.json",
            headers=shopify_headers(),
            params={
                'fields': 'id,title,handle,product_type,tags,status,variants,options,images'
            },
            timeout=10
        )
 
        if product_response.status_code != 200:
            return jsonify({'error': 'Failed to fetch product details'}), 500
 
        product = product_response.json().get('product', {})
        if not product:
            return jsonify({'error': 'Product not found'}), 404
 
        # Process variants
        processed_variants = []
        for v in product.get('variants', []):
            inventory_qty    = v.get('inventory_quantity', 0)
            inventory_policy = v.get('inventory_policy', 'deny')
            available        = inventory_qty > 0 or inventory_policy == 'continue'
            processed_variants.append({
                'id':                 v.get('id'),
                'title':              v.get('title'),
                'sku':                v.get('sku') or '',
                'price':              v.get('price'),
                'compare_at_price':   v.get('compare_at_price'),
                'inventory_quantity': inventory_qty,
                'inventory_policy':   inventory_policy,
                'available':          available,
                'option1':            v.get('option1'),
                'option2':            v.get('option2'),
                'option3':            v.get('option3'),
                'image_id':           v.get('image_id'),
                'weight':             v.get('weight'),
                'weight_unit':        v.get('weight_unit'),
            })
 
        # Process images — sort variant-specific first
        images = []
        for img in product.get('images', []):
            images.append({
                'id':          img.get('id'),
                'src':         img.get('src'),
                'alt':         img.get('alt'),
                'variant_ids': img.get('variant_ids', []),
                'position':    img.get('position', 0),
            })
        images.sort(key=lambda x: (len(x['variant_ids']) == 0, x['position']))
 
        return jsonify({
            'product': {
                'id':           product.get('id'),
                'title':        product.get('title'),
                'handle':       product.get('handle'),
                'product_type': product.get('product_type'),
                'tags':         product.get('tags'),
                'status':       product.get('status'),
                'variants':     processed_variants,
                'options':      product.get('options', []),
                'images':       images,
            }
        })
 
    except requests.Timeout:
        logger.error(f"Timeout looking up SKU {sku}")
        return jsonify({'error': 'Request timed out'}), 504
 
    except Exception as e:
        logger.error(f"Error looking up SKU {sku}: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ==========================================================
# CUSTOMER BALANCE ENDPOINTS - Add these to your app.py
# ==========================================================

@app.route('/api/customer/balances', methods=['POST'])
@require_api_key
def get_customer_balances():
    """Ultra-lean, memory-efficient fetch for balances using HTTP Keep-Alive"""
    try:
        data = request.get_json()
        if not data or not data.get('identifier'):
            return jsonify({'error': 'Missing identifier'}), 400

        identifier = data.get('identifier').strip()
        identifier_type = data.get('identifierType', 'email')

        # 1. TCP Connection Pooling (Saves ~500ms-1s by skipping the second SSL handshake)
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        })
        graphql_url = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"

        # 2. Optimized Query 1: Get Customer AND Store Credit in one tiny payload
        customer_node = None
        if identifier_type == 'email':
            q1 = """
            query($email: String!) {
              customer: customerByIdentifier(identifier: {emailAddress: $email}) {
                id legacyResourceId email
                storeCreditAccounts(first: 5) { nodes { id balance { amount currencyCode } } }
              }
            }
            """
            res = session.post(graphql_url, json={"query": q1, "variables": {"email": identifier}}, timeout=10)
            customer_node = res.json().get('data', {}).get('customer')
        else:
            clean_phone = re.sub(r'\D', '', identifier)[-10:]
            q1 = """
            query($phone: String!) {
              customers(first: 1, query: $phone) {
                nodes {
                  id legacyResourceId email
                  storeCreditAccounts(first: 5) { nodes { id balance { amount currencyCode } } }
                }
              }
            }
            """
            res = session.post(graphql_url, json={"query": q1, "variables": {"phone": f"phone:*{clean_phone}*"}}, timeout=10)
            nodes = res.json().get('data', {}).get('customers', {}).get('nodes', [])
            if nodes: 
                customer_node = nodes[0]

        # Exit early if no customer exists
        if not customer_node:
            return jsonify({'customer_found': False, 'store_credit_accounts': [], 'gift_cards': []}), 200

        # 3. Extract Store Credit cleanly
        store_credits = []
        for acc in customer_node.get('storeCreditAccounts', {}).get('nodes', []):
            store_credits.append({
                'id': acc.get('id'),
                'balance_amount': float(acc.get('balance', {}).get('amount', 0)),
                'balance_currency': acc.get('balance', {}).get('currencyCode', 'INR')
            })

        # 4. Optimized Query 2: Get Gift Cards using the exact same open connection
        legacy_id = customer_node.get('legacyResourceId')
        gift_cards = []
        
        if legacy_id:
            q2 = """
            query($query: String!) {
              giftCards(first: 15, query: $query) {
                nodes { id maskedCode balance { amount currencyCode } }
              }
            }
            """
            res2 = session.post(graphql_url, json={"query": q2, "variables": {"query": f"customer_id:{legacy_id} status:enabled"}}, timeout=10)
            
            for gc in res2.json().get('data', {}).get('giftCards', {}).get('nodes', []):
                gift_cards.append({
                    'id': gc.get('id'),
                    'code': gc.get('maskedCode'),
                    'balance_amount': float(gc.get('balance', {}).get('amount', 0)),
                    'balance_currency': gc.get('balance', {}).get('currencyCode', 'INR')
                })

        # 5. Return payload
        return jsonify({
            'customer_found': True,
            'email': customer_node.get('email', ''),
            'customer_graphql_id': customer_node.get('id'),
            'customer_legacy_id': legacy_id,
            'store_credit_accounts': store_credits,
            'gift_cards': gift_cards
        }), 200

    except Exception as e:
        logger.error(f"Balances error: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to process balance request'}), 500

def find_customer_by_identifier(identifier: str, identifier_type: str) -> Optional[Dict]:
    """Find customer by email or phone using Shopify GraphQL API"""
    try:
        shopify_service = get_shopify_service()
        
        if identifier_type == 'email':
            # Use customerByIdentifier for email lookup
            query = """
            query GetCustomerByEmail($identifier: CustomerIdentifierInput!) {
                customer: customerByIdentifier(identifier: $identifier) {
                    id
                    legacyResourceId
                    email
                    firstName
                    lastName
                    phone
                }
            }
            """
            variables = {
                "identifier": {
                    "emailAddress": identifier
                }
            }
            
            result = shopify_service._make_graphql_request(query, variables)
            customer = result.get('customer')
            
            if customer:
                return customer
            return None
            
        else:  # phone search
            # Clean the phone number for search
            clean_phone = re.sub(r'\D', '', identifier)
            # Take last 10 digits for matching
            clean_phone = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
                        
            # First try to find customer by phone using customers query
            query = """
            query GetCustomerByPhone($query: String!) {
                customers(first: 5, query: $query) {
                    edges {
                        node {
                            id
                            legacyResourceId
                            email
                            firstName
                            lastName
                            phone
                        }
                    }
                }
            }
            """
            variables = {
                "query": f"phone:*{clean_phone}*"
            }
            
            result = shopify_service._make_graphql_request(query, variables)
            customers = result.get('customers', {}).get('edges', [])
            
            if customers:
                customer = customers[0].get('node')
                return customer
            
            logger.warning(f"No customer found with phone: {clean_phone}")
            return None
        
    except Exception as e:
        logger.error(f"Error finding customer: {str(e)}", exc_info=True)
        return None


def get_customer_store_credit_accounts(customer: Dict) -> List[Dict]:
    """Get store credit accounts for a customer"""
    try:
        shopify_service = get_shopify_service()
        customer_id = customer.get('id')
        
        if not customer_id:
            logger.warning("Customer ID missing for store credit fetch")
            return []
                
        query = """
        query GetStoreCreditAccounts($customerId: ID!) {
            customer(id: $customerId) {
                storeCreditAccounts(first: 10) {
                    nodes {
                        id
                        balance {
                            amount
                            currencyCode
                        }
                    }
                }
            }
        }
        """
        
        result = shopify_service._make_graphql_request(query, {
            "customerId": customer_id
        })
        
        accounts = result.get('customer', {}).get('storeCreditAccounts', {}).get('nodes', [])
                
        return [{
            'id': acc['id'],
            'balance_amount': float(acc['balance']['amount']),
            'balance_currency': acc['balance']['currencyCode']
        } for acc in accounts]
        
    except Exception as e:
        logger.error(f"Error fetching store credit: {str(e)}", exc_info=True)
        return []


def get_customer_gift_cards(customer: Dict) -> List[Dict]:
    """Get gift cards for a customer using their legacy resource ID"""
    try:
        shopify_service = get_shopify_service()
        legacy_id = customer.get('legacyResourceId')
        
        if not legacy_id:
            logger.warning("Legacy resource ID missing for gift card fetch")
            return []
                
        query = """
        query GetCustomerGiftCards($query: String!) {
            giftCards(first: 50, query: $query) {
                edges {
                    node {
                        id
                        balance {
                            amount
                            currencyCode
                        }
                        maskedCode
                        customer {
                            id
                        }
                    }
                }
            }
        }
        """
        
        search_query = f"customer_id:{legacy_id} status:enabled"
        
        result = shopify_service._make_graphql_request(query, {
            "query": search_query
        })
        
        gift_cards = result.get('giftCards', {}).get('edges', [])
                
        return [{
            'id': gc['node']['id'],
            'balance_amount': float(gc['node']['balance']['amount']),
            'balance_currency': gc['node']['balance']['currencyCode'],
            'code': gc['node'].get('maskedCode'), # CHANGED: Map maskedCode to code for your frontend
            'customer_id': gc['node'].get('customer', {}).get('id') if gc['node'].get('customer') else None
        } for gc in gift_cards]
        
    except Exception as e:
        logger.error(f"Error fetching gift cards: {str(e)}", exc_info=True)
        return []

@app.route('/api/webhooks/return-received', methods=['POST'])
@require_api_key
def return_received():
    """Forward return received notification to n8n"""
    try:
        data = request.get_json()
        
        def format_refund_method(method):
            methods = {'store_credit': 'Store Credit', 'gift_card': 'Gift Card', 'refund': 'Original Payment Method'}
            return methods.get(method, method or 'Store Credit')
        
        payload = {
            **data,
            'refundMethodDisplay': format_refund_method(data.get('requestedMethod')),
            'notificationType': 'return_received',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_RETURN_RECEIVED_WEBHOOK, payload, "return-received")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in return-received webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500
    
@app.route('/api/webhooks/item-rejection', methods=['POST'])
@require_api_key
def item_rejection():
    """Forward item rejection to n8n"""
    try:
        data = request.get_json()
        
        payload = {
            **data,
            'notificationType': 'item_rejected',
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        success = trigger_webhook(N8N_ITEM_REJECTION_WEBHOOK, payload, "item-rejected")
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error in item-rejection webhook: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ==========================================================
# BLUE DART ENDPOINTS
# ==========================================================
@app.route("/api/bluedart/waybill/generate", methods=["POST"])
@require_api_key
def generate_waybill():
    """Generate Blue Dart waybill and pickup"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        
        ran = data.get('Request', {}).get('Services', {}).get('CreditReferenceNo')
        metadata = data.get('Metadata', {})
        
        if not ran:
            return jsonify({"success": False, "error": "Missing RAN (CreditReferenceNo)"}), 400
                
        headers = get_bluedart_auth_headers()
        response = requests.post(
            BlueDartConfig.BLUEDART_WAYBILL_URL,
            json=data,
            headers=headers,
            timeout=BlueDartConfig.REQUEST_TIMEOUT
        )
        
        try:
            response_data = response.json()
        except:
            response_data = {"raw_response": response.text}
        
        if response.status_code != 200:
            logger.error(f"BlueDart waybill generation failed (HTTP {response.status_code}) for RAN={ran}: {response_data}")
            return jsonify({"success": False, "error": "Waybill generation failed", "response": response_data}), 400
        
        result = response_data.get("GenerateWayBillResult", response_data)
        
        if result.get("IsError"):
            status_list = result.get("Status", [])
            error_msg = status_list[0].get("StatusInformation", "Provider Error") if status_list else "Validation Error"
            return jsonify({"success": False, "error": error_msg, "response": response_data}), 400
        
        awb_number = result.get("AWBNo")
        token_number = result.get("TokenNumber")
        pickup_date = result.get("PickupDate")
        base64_pdf = result.get("AWBPrintContent")
        
        if not awb_number:
            return jsonify({"success": False, "error": "AWB not returned by provider"}), 500
                
        label_url = None
        
        if base64_pdf and bucket:
            try:
                import base64 as b64
                if isinstance(base64_pdf, list):
                    if isinstance(base64_pdf[0], int):
                        pdf_bytes = bytes(base64_pdf)
                    elif isinstance(base64_pdf[0], str):
                        pdf_bytes = b64.b64decode(base64_pdf[0])
                elif isinstance(base64_pdf, str):
                    pdf_bytes = b64.b64decode(base64_pdf)
                else:
                    raise ValueError("Invalid AWBPrintContent format")
                
                blob_path = f"returns/{ran}/labels/AWB_{awb_number}.pdf"
                blob = bucket.blob(blob_path)
                blob.upload_from_string(pdf_bytes, content_type="application/pdf")
                
                safe_path = urllib.parse.quote(blob_path, safe="")
                label_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{safe_path}?alt=media"
                
            except Exception as e:
                logger.error(f"Label upload failed: {str(e)}")
        
        firebase_updated = update_firebase_with_waybill(
            ran=ran, awb_number=awb_number, token_number=token_number,
            pickup_date=pickup_date, label_url=label_url, result=result, metadata=metadata
        )
        
        return jsonify({
            "success": True,
            "awbNumber": awb_number,
            "tokenNumber": token_number,
            "pickupDate": pickup_date,
            "labelUrl": label_url,
            "firebaseUpdated": firebase_updated,
            "message": "Pickup created successfully"
        })
    except Exception as e:
        logger.error(f"Error generating waybill: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/bluedart/waybill/cancel", methods=["POST"])
@require_api_key
def cancel_waybill():
    """Cancel a waybill and the physical truck pickup"""
    try:
        data = request.get_json()
        awb_number = data.get('awbNumber')
        
        if not awb_number:
            return jsonify({"success": False, "error": "Missing awbNumber"}), 400
        
        token_number = data.get('tokenNumber')
        pickup_date = data.get('pickupDate')
        ran = data.get('ran')
        
        headers = get_bluedart_auth_headers()
        
        # Cancel AWB
        awb_payload = {
            "Request": {"AWBNo": awb_number},
            "Profile": {
                "LoginID": BlueDartConfig.BD_LOGIN_ID,
                "LicenceKey": BlueDartConfig.BD_LICENCE_KEY,
                "Api_type": "S"
            }
        }
        
        awb_response = requests.post(
            BlueDartConfig.BLUEDART_CANCEL_WAYBILL_URL,
            json=awb_payload,
            headers=headers,
            timeout=BlueDartConfig.REQUEST_TIMEOUT
        )
        
        try:
            awb_result = awb_response.json()
        except:
            awb_result = {"raw_response": awb_response.text}
        
        awb_inner = awb_result.get('CancelWaybillResult', awb_result)
        awb_status = "Success" if awb_response.status_code == 200 and not awb_inner.get('IsError') else "Failed"
        
        # Cancel pickup if token provided
        pickup_status = "No token provided"
        if token_number and pickup_date:
            try:
                numeric_token = int(str(token_number).strip())
                pickup_payload = {
                    "request": {
                        "TokenNumber": numeric_token,
                        "PickupRegistrationDate": str(pickup_date),
                        "Remarks": "Cancelled via Returns Portal"
                    },
                    "profile": {
                        "LoginID": BlueDartConfig.BD_LOGIN_ID,
                        "LicenceKey": BlueDartConfig.BD_LICENCE_KEY,
                        "Api_type": "S"
                    }
                }
                
                pickup_response = requests.post(
                    BlueDartConfig.BLUEDART_CANCEL_PICKUP_URL,
                    json=pickup_payload,
                    headers=headers,
                    timeout=BlueDartConfig.REQUEST_TIMEOUT
                )
                
                pickup_result = pickup_response.json() if pickup_response.status_code == 200 else {"raw_response": pickup_response.text}
                pickup_inner = pickup_result.get('CancelPickupResult', pickup_result)
                pickup_status = "Success" if pickup_response.status_code == 200 and not pickup_inner.get('IsError') else "Failed"
            except Exception as e:
                logger.error(f"Pickup cancellation error: {e}")
                pickup_status = f"Error: {str(e)}"
        
        # Update Firebase
        if db and ran:
            try:
                docs = list(db.collection("returns").where("RAN", "==", ran).limit(1).stream())
                if docs:
                    doc_ref = docs[0].reference
                    doc_ref.update({
                        "status": "Open", # <--- FIX: Revert to Open instead of Cancelled
                        "shipmentStatus": "Pickup Cancelled",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                        "cancellationDetails": {
                            "awbCancelled": awb_status == "Success",
                            "pickupCancelled": pickup_status == "Success",
                            "cancelledAt": firestore.SERVER_TIMESTAMP
                        }
                    })
                    
                    db.collection("returns").document(doc_ref.id).collection("activities").add({
                        "type": "warning",
                        "title": "Pickup Cancelled",
                        "description": f"Pickup cancelled for AWB: {awb_number}",
                        "timestamp": firestore.SERVER_TIMESTAMP,
                        "user": "System",
                        "metadata": {"awb": awb_number}
                    })
            except Exception as e:
                logger.error(f"Firebase update failed: {e}")
        
        if awb_status == "Failed" and pickup_status == "Failed":
            return jsonify({"success": False, "error": "Both AWB and pickup cancellation failed"}), 400
        
        return jsonify({
            "success": True,
            "message": "Cancellation completed",
            "awb_cancellation_status": awb_status,
            "pickup_cancellation_status": pickup_status
        })
    except Exception as e:
        logger.error(f"Error cancelling waybill: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/bluedart/tracking", methods=["GET"])
@require_api_key
def track_shipment():
    """Track shipment by AWB number using Blue Dart Routing Servlet"""
    try:
        awb_numbers = request.args.get('awb', '')
        if not awb_numbers:
            return jsonify({"error": "AWB number required", "success": False}), 400
        
        # Using the reliable RoutingServlet parameters
        params = {
            "handler": "tnt",
            "action": "custawbquery",
            "loginid": BlueDartConfig.BD_LOGIN_ID,
            "lickey": BlueDartConfig.BD_TRACKING_LICENSE_KEY, # Using tracking specific key
            "numbers": awb_numbers,
            "format": "json", # Requesting JSON directly so frontend parsing works
            "verno": "1.3",
            "scan": "1",
            "awb": "awb"
        }
        
        # Notice we removed the JWT headers, the RoutingServlet doesn't need them
        response = requests.get(
            BlueDartConfig.BLUEDART_TRACKING_URL,
            params=params,
            timeout=BlueDartConfig.REQUEST_TIMEOUT
        )
        
        tracking_data = response.json() if response.status_code == 200 else None
        
        if tracking_data:
            shipment_data = tracking_data.get('ShipmentData', {})
            
            if isinstance(shipment_data, dict) and 'Error' in shipment_data:
                error_msg = shipment_data['Error']
                logger.error(f"Blue Dart API Error for AWB {awb_numbers}: {error_msg}")
                return jsonify({"success": False, "error": f"Blue Dart: {error_msg}"}), 400
            
            # Normal logging parsing...
            if isinstance(shipment_data, list):
                shipment = shipment_data[0].get('Shipment', shipment_data[0])
            elif isinstance(shipment_data, dict) and 'Shipment' in shipment_data:
                s = shipment_data['Shipment']
                shipment = s[0] if isinstance(s, list) else s
            else:
                shipment = shipment_data
            
            if isinstance(shipment, dict):
                status = shipment.get('Status', 'UNKNOWN')
                status_type = shipment.get('StatusType', 'UNKNOWN')
                logger.info(f"🚚 AWB {awb_numbers} Status: {status} (Type: {status_type})")
        
        return jsonify({
            "success": response.status_code == 200,
            "tracking": tracking_data,
            "error": None if response.status_code == 200 else "Tracking failed"
        })
        
    except Exception as e:
        logger.error(f"Error tracking shipment: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
    
@app.route('/api/auth/login', methods=['POST'])
@require_api_key
def login_agent():
    """Authenticates the agent or triggers first-time setup"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        password_or_phone = data.get('password', '').strip()

        if not db:
            return jsonify({"error": "Database not connected"}), 500

        docs = list(db.collection("agents").where(filter=FieldFilter("email", "==", email)).limit(1).stream())
        if not docs:
            return jsonify({"error": "Invalid email or credentials"}), 401
        
        agent_doc = docs[0]
        agent_data = agent_doc.to_dict()

        if agent_data.get("hasSetPassword"):
            # Note: In a production environment, you should use hashed passwords (e.g., bcrypt)
            if agent_data.get("password") == password_or_phone:
                return jsonify({"success": True, "needsSetup": False, "agent": {
                    "email": agent_data.get("email"),
                    "name": agent_data.get("name"),
                    "role": "agent",
                    "profilePic": agent_data.get("profilePic", "")
                }})
            return jsonify({"error": "Invalid email or password"}), 401
        else:
            # First time login using phone number
            if agent_data.get("phone") == password_or_phone:
                return jsonify({"success": True, "needsSetup": True})
            return jsonify({"error": "Invalid email or phone number"}), 401

    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/auth/setup-password', methods=['POST'])
@require_api_key
def setup_password():
    """Saves the new password for the agent"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        new_password = data.get('password', '')

        docs = list(db.collection("agents").where(filter=FieldFilter("email", "==", email)).limit(1).stream())
        if not docs:
            return jsonify({"error": "Agent not found"}), 404
        
        doc_ref = docs[0].reference
        doc_ref.update({
            "password": new_password, # Should be hashed in production
            "hasSetPassword": True
        })

        agent_data = docs[0].to_dict()
        return jsonify({"success": True, "agent": {
            "email": agent_data.get("email"),
            "name": agent_data.get("name"),
            "role": "agent",
            "profilePic": agent_data.get("profilePic", "")
        }})

    except Exception as e:
        logger.error(f"Setup password error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/auth/send-otp', methods=['POST'])
@require_api_key
def send_otp():
    """Generates an OTP securely on the backend and triggers n8n"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()

        # FIX: Updated the where() syntax to use standard positional arguments
        docs = list(db.collection("agents").where(filter=FieldFilter("email", "==", email)).limit(1).stream())
        
        if not docs:
            return jsonify({"error": "Email not found"}), 404
        
        # Generate 6-digit OTP
        otp = str(random.randint(100000, 999999))
        expiry = datetime.now() + timedelta(minutes=10) # OTP valid for 10 mins
        
        doc_ref = docs[0].reference
        doc_ref.update({
            "resetOtp": otp,
            "otpExpiry": expiry
        })

        # Trigger n8n Webhook
        if N8N_OTP_WEBHOOK:
            requests.post(N8N_OTP_WEBHOOK, json={"email": email, "otp": otp}, timeout=10)

        return jsonify({"success": True, "message": "OTP sent successfully"})

    except Exception as e:
        logger.error(f"Send OTP error: {str(e)}")
        return jsonify({"error": "Failed to generate OTP"}), 500

@app.route('/api/auth/verify-otp', methods=['POST'])
@require_api_key
def verify_otp():
    """Validates the OTP entered by the user against the database"""
    try:
        data = request.get_json()
        email = data.get('email', '').strip()
        entered_otp = data.get('otp', '').strip()

        docs = list(db.collection("agents").where(filter=FieldFilter("email", "==", email)).limit(1).stream())
        if not docs:
            return jsonify({"error": "Agent not found"}), 404
        
        agent_data = docs[0].to_dict()
        stored_otp = agent_data.get("resetOtp")
        expiry = agent_data.get("otpExpiry")

        if not stored_otp or not expiry:
            return jsonify({"error": "No OTP requested"}), 400

        # Handle Firestore datetime format
        if hasattr(expiry, 'timestamp'):
            expiry_dt = datetime.fromtimestamp(expiry.timestamp())
        else:
            expiry_dt = expiry 

        if datetime.now() > expiry_dt:
            return jsonify({"error": "OTP has expired"}), 400

        if stored_otp != entered_otp:
            return jsonify({"error": "Invalid OTP"}), 400

        # OTP is valid, clear it
        docs[0].reference.update({
            "resetOtp": None,
            "otpExpiry": None
        })

        return jsonify({"success": True})

    except Exception as e:
        logger.error(f"Verify OTP error: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500
    
# ==========================================================
# HEALTH CHECK
# ==========================================================
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    firebase_status = "connected" if db else "disconnected"
    return jsonify({
        'status': 'healthy',
        'service': 'unified-api',
        'version': '1.0.0',
        'firebase': firebase_status,
        'shopify': 'configured' if SHOPIFY_ACCESS_TOKEN else 'missing',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }), 200


@app.route('/webhook', methods=['POST'])
def webhook():
    """Generic webhook endpoint for testing"""
    data = request.get_json(silent=True)
    logger.info(f"Webhook received: {data}")
    return "OK", 200


# ==========================================================
# ERROR HANDLERS
# ==========================================================
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500


# ==========================================================
# MAIN ENTRY POINT
# ==========================================================
@https_fn.on_request(max_instances=10)
def prashanti_returns_api(req: https_fn.Request) -> https_fn.Response:
    """Wraps the Flask app to be served as a Firebase Cloud Function."""
    with app.request_context(req.environ):
        return app.full_dispatch_request()

# if __name__ == '__main__':
#     app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
