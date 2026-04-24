import os
import logging
import re
import urllib.parse
import requests
from typing import Optional, Dict, Any, List, Union
from functools import wraps
from dataclasses import dataclass, asdict
from enum import Enum
from datetime import datetime
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from dotenv import load_dotenv
from firebase_functions import https_fn
# Firebase Imports
import firebase_admin
from firebase_admin import credentials, firestore, storage as fb_storage

load_dotenv()

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
        logger.info(f"✅ Firebase Admin Initialized. Target Bucket: {storage_bucket_name}")
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
    """Send webhook notification"""
    try:
        logger.info(f"Sending {log_context} webhook: {payload}")
        response = requests.post(url, json=payload, headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }, timeout=10)
        
        if response.ok:
            logger.info(f"{log_context} webhook successful")
            return True
        else:
            logger.warning(f"{log_context} webhook returned status: {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"Failed to send {log_context} notification: {str(e)}")
        return False

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
        
        self.GET_CUSTOMER_STORE_CREDIT_ACCOUNT = """
        query GetCustomerStoreCreditAccount($customerId: ID!) {
          customer(id: $customerId) {
            id
            email
            storeCreditAccounts(first: 1) {
              edges {
                node {
                  id
                  balance {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
        """
    
    def _make_graphql_request(self, query: str, variables: Optional[Dict] = None) -> Dict:
        headers = {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": self.access_token,
        }
        
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        
        try:
            response = requests.post(
                self.graphql_endpoint,
                json=payload,
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            if "errors" in data:
                error_messages = [e.get("message", "Unknown error") for e in data["errors"]]
                logger.error(f"GraphQL errors: {error_messages}")
                raise Exception(f"GraphQL errors: {', '.join(error_messages)}")
            
            return data.get("data", {})
            
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
    
    def get_customer_store_credit_account(self, customer_id: str) -> Optional[Dict]:
        try:
            result = self._make_graphql_request(
                self.GET_CUSTOMER_STORE_CREDIT_ACCOUNT,
                variables={"customerId": customer_id}
            )
            
            customer = result.get("customer", {})
            accounts = customer.get("storeCreditAccounts", {}).get("edges", [])
            
            if accounts:
                return accounts[0].get("node", {})
            
            return None
        except Exception as e:
            logger.error(f"Failed to fetch store credit account: {str(e)}")
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
        """Process a financial-only refund to enforce custom deductions."""
        if isinstance(refund_amount, (int, float)):
            refund_amount = f"{refund_amount:.2f}"
        
        refund_input: Dict[str, Any] = {
            "orderId": order_gid,
            "transactions": [
                {
                    "orderId": order_gid,              # ✅ ADDED: Shopify requires the orderId inside the transaction too
                    "parentId": parent_transaction_id,
                    "kind": "REFUND",
                    "gateway": gateway,
                    "amount": str(refund_amount),      # ✅ FIXED: Passed as a direct string, not a dictionary
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
    
    def process_refund(self, order_gid: str, amount: Union[str, float], refund_method: RefundMethod, 
                       line_item_refunds: List[Dict], note: str, notify_customer: bool, metadata: Dict) -> RefundResult:
        """Centralized processor for non-original payment refunds (Store Credit & Gift Card)"""
        try:
            # 1. Fetch necessary order details
            order_details = self.get_order_details(order_gid)
            customer = order_details.get('customer', {})
            customer_id = customer.get('id')
            customer_email = order_details.get('email') or customer.get('email')
            currency = order_details.get('totalPriceSet', {}).get('shopMoney', {}).get('currencyCode', 'INR')
            
            # Set up our baseline result
            result_kwargs = {
                'success': True,
                'refund_method': refund_method,
                'amount': str(amount),
                'currency': currency,
                'customer_email': customer_email,
                'order_name': order_details.get('name')
            }

            # 2. Route based on the refund method
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
                
                account = self.get_customer_store_credit_account(customer_id)
                if not account:
                    raise ValueError("No active store credit account found for this customer.")
                
                transaction = self.create_store_credit_account_credit(
                    account_id=account['id'],
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

            # 3. Create the result object and update Firebase
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
        
    def update_firebase_with_refund(self, refund_result: RefundResult, metadata: Optional[Dict] = None) -> bool:
        if not db:
            return False
        
        try:
            order_id = metadata.get('orderId') if metadata else None
            if not order_id:
                return False
            
            return_ref = db.collection('returns').document(order_id)
            return_doc = return_ref.get()
            
            if not return_doc.exists:
                return False
            
            refund_details = {
                'method': refund_result.refund_method.value,
                'finalAmount': float(refund_result.amount) if refund_result.amount else 0,
                'shopifyRefundId': refund_result.refund_id or refund_result.transaction_id,
                'transactionId': refund_result.transaction_id,
                'giftCardCode': refund_result.gift_card_code,
                'transactions': refund_result.transactions,
                'shopifyResponse': refund_result.raw_response,
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
            }
            
            if refund_result.gift_card_code:
                update_data['giftCardCode'] = refund_result.gift_card_code
            
            return_ref.update(update_data)
            
            # Add activity log
            activities_ref = db.collection('returns').document(order_id).collection('activities')
            activities_ref.add({
                'type': 'success',
                'title': 'Refund Issued',
                'description': f"Refund of ₹{float(refund_result.amount):.2f} issued via {refund_result.refund_method.value.replace('_', ' ')}",
                'timestamp': firestore.SERVER_TIMESTAMP,
                'user': 'System',
                'metadata': refund_details
            })
            
            return True
        except Exception as e:
            logger.error(f"Firebase update failed: {str(e)}")
            return False


def get_shopify_service():
    """Get or create Shopify service instance"""
    shop_domain = os.getenv('SHOPIFY_SHOP_DOMAIN', SHOPIFY_STORE)
    access_token = os.getenv('SHOPIFY_ACCESS_TOKEN', SHOPIFY_ACCESS_TOKEN)
    api_version = os.getenv('SHOPIFY_API_VERSION', SHOPIFY_API_VERSION)
    
    if not shop_domain or not access_token:
        raise ValueError("Shopify credentials not configured")
    
    return ShopifyService(shop_domain, access_token, api_version)


# ==========================================================
# BLUE DART CONFIGURATION
# ==========================================================
class BlueDartConfig:
    BLUEDART_TOKEN_URL = "https://apigateway.bluedart.com/in/transportation/token/v1/login"
    BLUEDART_WAYBILL_URL = "https://apigateway.bluedart.com/in/transportation/waybill/v1/GenerateWayBill"
    BLUEDART_CANCEL_WAYBILL_URL = "https://apigateway.bluedart.com/in/transportation/waybill/v1/CancelWaybill"
    BLUEDART_CANCEL_PICKUP_URL = "https://apigateway.bluedart.com/in/transportation/cancel-pickup/v1/CancelPickup" 
    BLUEDART_TRACKING_URL = "https://apigateway.bluedart.com/in/transportation/tracking/v1/shipment"
    
    BD_CLIENT_ID = os.getenv("BD_CLIENT_ID")
    BD_CLIENT_SECRET = os.getenv("BD_CLIENT_SECRET")
    BD_LOGIN_ID = os.getenv("BD_LOGIN_ID")
    BD_LICENCE_KEY = os.getenv("BD_LICENCE_KEY")
    BD_CUSTOMER_CODE = os.getenv("BD_CUSTOMER_CODE", "503705")
    
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
    """Update Firebase with waybill details"""
    if not db:
        return False
    
    try:
        docs = list(db.collection("returns").where("RAN", "==", ran).limit(1).stream())
        if not docs:
            logger.warning(f"No return found for RAN {ran}")
            return False

        doc_ref = docs[0].reference
        
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

        db.collection("returns").document(doc_ref.id).collection("activities").add({
            "type": "success",
            "title": "Pickup Created",
            "description": f"Return pickup scheduled. AWB: {awb_number}",
            "timestamp": firestore.SERVER_TIMESTAMP,
            "user": "System",
            "metadata": {"awb": awb_number, "tokenNumber": token_number}
        })

        return True
    except Exception as e:
        logger.error(f"Firestore update failed: {str(e)}")
        return False


# ==========================================================
# ORIGINAL SHOPIFY PROXY ENDPOINTS
# ==========================================================
@app.route('/api/orders/verify', methods=['POST'])
@require_api_key
def verify_order():
    """Verify order by name and customer identifier"""
    try:
        data = request.get_json()
        order_name = data.get('orderName')
        verification_input = data.get('verificationInput')
        
        if not order_name or not verification_input:
            return jsonify({'error': 'Missing required fields'}), 400
        
        params = {
            'name': order_name,
            'status': 'any',
            'fields': 'id,name,email,phone,customer,line_items,fulfillment_status,created_at,shipping_address,tags,currency,order_number,total_price'
        }
        
        response = requests.get(
            f"{SHOPIFY_BASE_URL}/orders.json",
            headers=shopify_headers(),
            params=params,
            timeout=10
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order'}), 500
        
        orders = response.json().get('orders', [])
        matched_order = next((o for o in orders if o.get('name') == order_name), None)
        
        if not matched_order or matched_order.get('fulfillment_status') != 'fulfilled':
            return jsonify({'error': 'Order not found or not fulfilled'}), 404
        
        if verify_order_ownership(matched_order, verification_input):
            return jsonify({'order': matched_order})
        else:
            return jsonify({'error': 'Verification failed'}), 403
            
    except Exception as e:
        logger.error(f"Error verifying order: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


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
            'fields': 'id,name,email,phone,customer,line_items,fulfillment_status,created_at,shipping_address,tags,currency,order_number,total_price'
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


@app.route('/api/orders/<int:order_id>/restock', methods=['POST'])
@require_api_key
def restock_items(order_id):
    """Create a Return in Shopify UI and Restock the items"""
    try:
        data = request.get_json()
        items = data.get('items', [])
        
        if not items:
            return jsonify({'message': 'No items to restock'}), 200
        
        graphql_url = f"https://{SHOPIFY_STORE}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"
        headers = shopify_headers()
        order_gid = f"gid://shopify/Order/{order_id}"

        # ---------------------------------------------------------
        # STEP 1: Get FulfillmentLineItem IDs
        # To create a return, Shopify requires the ID of the specific 
        # fulfillment that shipped the item, not just the line item ID.
        # ---------------------------------------------------------
        query_fulfillments = """
        query getFulfillments($id: ID!) {
          order(id: $id) {
            fulfillments(first: 10) {
              id
              fulfillmentLineItems(first: 50) {
                edges {
                  node {
                    id
                    quantity
                    lineItem {
                      id
                    }
                  }
                }
              }
            }
          }
        }
        """
        order_data = requests.post(
            graphql_url, headers=headers, 
            json={"query": query_fulfillments, "variables": {"id": order_gid}}
        ).json()

        fulfillments = order_data.get('data', {}).get('order', {}).get('fulfillments', [])
        
        return_line_items = []
        for item in items:
            target_gid = f"gid://shopify/LineItem/{item['lineItemId']}"
            qty = item['quantityReturned']
            
            # Match the standard line item to the fulfillment line item
            for f in fulfillments:
                for edge in f.get('fulfillmentLineItems', {}).get('edges', []):
                    node = edge['node']
                    if node['lineItem']['id'] == target_gid:
                        return_line_items.append({
                            "fulfillmentLineItemId": node['id'],
                            "quantity": qty,
                            "returnReason": "UNKNOWN" # Standard fallback reason
                        })
                        break

        # ---------------------------------------------------------
        # STEP 2: Create the Return (Shows in Shopify UI)
        # ---------------------------------------------------------
        if return_line_items:
            mutation_return = """
            mutation returnCreate($returnInput: ReturnInput!) {
              returnCreate(returnInput: $returnInput) {
                return {
                  id
                }
                userErrors {
                  message
                }
              }
            }
            """
            return_res = requests.post(
                graphql_url, headers=headers, 
                json={
                    "query": mutation_return, 
                    "variables": {
                        "returnInput": {
                            "orderId": order_gid,
                            "returnLineItems": return_line_items
                        }
                    }
                }
            ).json()
            
            # If a return is already open for this item, Shopify throws an error.
            # We log it, but proceed to restock anyway so the process doesn't halt.
            user_errors = return_res.get('data', {}).get('returnCreate', {}).get('userErrors', [])
            if user_errors:
                logger.warning(f"Return creation warning (may already exist): {user_errors}")

        # ---------------------------------------------------------
        # STEP 3: Restock the Inventory via REST API
        # By processing a refund with `restock_type: return`, Shopify 
        # increments inventory and automatically ties it to the Return above.
        # ---------------------------------------------------------
        order_response = requests.get(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}.json",
            headers=headers,
            timeout=10
        )
        
        if order_response.status_code != 200:
            return jsonify({'error': 'Failed to fetch order details for restocking'}), 500
            
        order = order_response.json().get('order', {})
        fulfillments_rest = order.get('fulfillments', [])
        location_id = fulfillments_rest[0].get('location_id') if fulfillments_rest else None
        
        if not location_id:
            return jsonify({'error': 'Could not determine Location ID for restocking'}), 400

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
                'currency': order.get('currency'),
                'notify': False,  # Prevents confusing emails
                'refund_line_items': refund_line_items,
                'transactions': [] # Leaves financials untouched; just inventory
            }
        }
        
        response = requests.post(
            f"{SHOPIFY_BASE_URL}/orders/{order_id}/refunds.json",
            headers=headers,
            json=payload,
            timeout=10
        )
        
        if response.status_code in [200, 201]:
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Failed to restock items', 'details': response.json()}), response.status_code
            
    except Exception as e:
        logger.error(f"Error returning/restocking items: {str(e)}")
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
            'timestamp': datetime.utcnow().isoformat()
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
            'timestamp': datetime.utcnow().isoformat()
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
            'timestamp': datetime.utcnow().isoformat()
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
            'timestamp': datetime.utcnow().isoformat()
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
            'timestamp': datetime.utcnow().isoformat()
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
        
        # Process refund
        result = shopify_service.process_refund(
            order_gid=order_gid,
            amount=data['amount'],
            refund_method=RefundMethod.GIFT_CARD,
            line_item_refunds=data['lineItems'],
            note=data.get('note', f"Gift card refund for order {data['orderId']}"),
            notify_customer=data.get('notifyCustomer', True),
            metadata=data
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
        
        result = shopify_service.process_refund(
            order_gid=order_gid,
            amount=data['amount'],
            refund_method=RefundMethod.STORE_CREDIT,
            line_item_refunds=data['lineItems'],
            note=data.get('note', f"Store credit refund for order {data['orderId']}"),
            notify_customer=data.get('notifyCustomer', True),
            metadata=data
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
        
        # Step 1: Fetch the order to get the currency and the Parent Transaction
        order_details = shopify_service.get_order_details(order_gid)
        currency_code = order_details.get('totalPriceSet', {}).get('shopMoney', {}).get('currencyCode', 'INR')
        
        # SAFE TRANSACTION PARSING: Handle both list and connection dicts from Shopify
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

        # Step 2: Call the updated refund method with the parent transaction details
        refund = shopify_service.refund_to_original_payment(
            order_gid=order_gid,
            refund_amount=data['amount'],
            currency_code=currency_code,
            parent_transaction_id=parent_transaction['id'],
            gateway=parent_transaction['gateway'],
            note=data.get('note'),
            notify=data.get('notifyCustomer', True)
        )
        
        # SAFE REFUND PARSING: Prevent IndexError if Shopify doesn't return edges
        refund_edges = refund.get('transactions', {}).get('edges', [])
        first_transaction = refund_edges[0].get('node', {}) if refund_edges else {}
        
        # Step 3: Map data to RefundResult so Firebase updates correctly
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
        
        firebase_updated = shopify_service.update_firebase_with_refund(refund_result, data)
        
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
    """Mark refund as manually processed"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        required_fields = ['orderId', 'amount']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
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
                            'note': data.get('note', 'Manual refund processed')
                        }
                    }
                    
                    return_ref.update(update_data)
                    
                    activities_ref = db.collection('returns').document(data['orderId']).collection('activities')
                    activities_ref.add({
                        'type': 'success',
                        'title': 'Refund Issued',
                        'description': f"Refund of ₹{float(data['amount']):.2f} marked as manually processed",
                        'timestamp': firestore.SERVER_TIMESTAMP,
                        'user': 'System',
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
            'note': data.get('note', 'Manual refund processed'),
            'firebaseUpdated': firebase_updated
        }), 200
    except Exception as e:
        logger.error(f"Error in manual refund: {str(e)}")
        return jsonify({'error': str(e)}), 500

# ==========================================================
# CUSTOMER BALANCE ENDPOINTS - Add these to your app.py
# ==========================================================

@app.route('/api/customer/balances', methods=['POST', 'OPTIONS'])
@require_api_key
def get_customer_balances():
    """Get both gift cards and store credit for a customer by email or phone"""
    # Handle preflight CORS request
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        data = request.get_json()
        if not data:
            logger.error("No JSON data received in request")
            return jsonify({'error': 'No data provided'}), 400
            
        identifier = data.get('identifier')
        identifier_type = data.get('identifierType', 'email')
        
        logger.info(f"Fetching balances for {identifier_type}: {identifier}")
        
        if not identifier:
            return jsonify({'error': 'Missing identifier'}), 400
        
        identifier = identifier.strip()
        
        # Validate identifier format
        if identifier_type == 'email':
            if '@' not in identifier or '.' not in identifier:
                return jsonify({'error': 'Invalid email format'}), 400
        elif identifier_type == 'phone':
            # Clean phone number and validate
            clean_phone = re.sub(r'\D', '', identifier)
            if len(clean_phone) < 10:
                return jsonify({'error': 'Invalid phone number (minimum 10 digits required)'}), 400
        
        # Step 1: Find the customer
        customer = find_customer_by_identifier(identifier, identifier_type)
        
        if not customer:
            logger.warning(f"No customer found for {identifier_type}: {identifier}")
            return jsonify({
                'customer_found': False,
                'email': identifier if identifier_type == 'email' else '',
                'store_credit_accounts': [],
                'gift_cards': []
            }), 200
        
        logger.info(f"Customer found: {customer.get('id')} - {customer.get('email')}")
        
        # Step 2: Get store credit accounts (with error handling)
        store_credit_accounts = []
        try:
            store_credit_accounts = get_customer_store_credit_accounts(customer)
            logger.info(f"Found {len(store_credit_accounts)} store credit accounts")
        except Exception as e:
            logger.error(f"Error fetching store credit: {str(e)}", exc_info=True)
            # Continue without store credit data
        
        # Step 3: Get gift cards (with error handling)
        gift_cards = []
        try:
            gift_cards = get_customer_gift_cards(customer)
            logger.info(f"Found {len(gift_cards)} gift cards")
        except Exception as e:
            logger.error(f"Error fetching gift cards: {str(e)}", exc_info=True)
            # Continue without gift card data
        
        response_data = {
            'customer_found': True,
            'email': customer.get('email', ''),
            'customer_graphql_id': customer.get('id'),
            'customer_legacy_id': customer.get('legacyResourceId'),
            'store_credit_accounts': store_credit_accounts,
            'gift_cards': gift_cards
        }
        
        logger.info(f"Successfully fetched balances for customer")
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Error fetching customer balances: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


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
                logger.info(f"Found customer by email: {customer.get('id')}")
                return customer
            return None
            
        else:  # phone search
            # Clean the phone number for search
            clean_phone = re.sub(r'\D', '', identifier)
            # Take last 10 digits for matching
            clean_phone = clean_phone[-10:] if len(clean_phone) >= 10 else clean_phone
            
            logger.info(f"Searching for customer with phone ending in: {clean_phone}")
            
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
                logger.info(f"Found customer by phone: {customer.get('id')}")
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
        
        logger.info(f"Fetching store credit for customer: {customer_id}")
        
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
        
        logger.info(f"Retrieved {len(accounts)} store credit accounts")
        
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
        
        logger.info(f"Fetching gift cards for customer legacy ID: {legacy_id}")
        
        # CHANGED: 'code' is now 'maskedCode'
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
        
        logger.info(f"Retrieved {len(gift_cards)} gift cards")
        
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
            'timestamp': datetime.utcnow().isoformat()
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
            'timestamp': datetime.utcnow().isoformat()
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
        
        logger.info(f"Generating pickup for RAN: {ran}")
        
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
        
        logger.info(f"AWB generated: {awb_number}")
        
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
                
                logger.info(f"Label stored: {label_url}")
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
        
        logger.info(f"Cancelling AWB: {awb_number}")
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
                        "status": "Cancelled",
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
    """Track shipment by AWB number"""
    try:
        awb_numbers = request.args.get('awb', '')
        if not awb_numbers:
            return jsonify({"error": "AWB number required", "success": False}), 400
        
        params = {
            "handler": "tnt",
            "loginid": BlueDartConfig.BD_LOGIN_ID,
            "lickey": BlueDartConfig.BD_LICENCE_KEY,
            "numbers": awb_numbers,
            "format": "json",
            "scan": "1",
            "action": "custawbquery",
            "verno": "1",
            "awb": "awb"
        }
        
        headers = get_bluedart_auth_headers()
        response = requests.get(
            BlueDartConfig.BLUEDART_TRACKING_URL,
            params=params,
            headers=headers,
            timeout=BlueDartConfig.REQUEST_TIMEOUT
        )
        
        tracking_data = response.json() if response.status_code == 200 else None
        
        return jsonify({
            "success": response.status_code == 200,
            "tracking": tracking_data,
            "error": None if response.status_code == 200 else "Tracking failed"
        })
    except Exception as e:
        logger.error(f"Error tracking shipment: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


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
        'timestamp': datetime.utcnow().isoformat()
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
