const axios = require('axios');

async function test() {
  try {
    console.log('Testing HIVE-Engine API...\n');

    const response = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: 'angelicalist' },
        limit: 5
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });

    console.log('✅ SUCCESS!');
    console.log(JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

test();
