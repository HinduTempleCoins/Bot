#!/bin/bash
# Quick check for trading bot orders - works anywhere with curl

ACCOUNT="${1:-angelicalist}"

echo "🔍 Checking HIVE-Engine orders for: $ACCOUNT"
echo "============================================"

echo ""
echo "📊 VKBT Buy Orders:"
curl -s -X POST https://api.hive-engine.com/rpc/contracts \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"find\",
    \"params\": {
      \"contract\": \"market\",
      \"table\": \"buyBook\",
      \"query\": {\"account\": \"$ACCOUNT\", \"symbol\": \"VKBT\"},
      \"limit\": 10
    }
  }" | python3 -c "import sys, json; data = json.load(sys.stdin); print(f'{len(data[\"result\"])} orders') if data['result'] else print('❌ No orders')"

echo ""
echo "📊 CURE Buy Orders:"
curl -s -X POST https://api.hive-engine.com/rpc/contracts \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"find\",
    \"params\": {
      \"contract\": \"market\",
      \"table\": \"buyBook\",
      \"query\": {\"account\": \"$ACCOUNT\", \"symbol\": \"CURE\"},
      \"limit\": 10
    }
  }" | python3 -c "import sys, json; data = json.load(sys.stdin); print(f'{len(data[\"result\"])} orders') if data['result'] else print('❌ No orders')"

echo ""
echo "💡 Usage: $0 [account_name]"
echo "   Example: $0 angelicalist"
