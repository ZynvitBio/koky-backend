const axios = require('axios');

axios.get('https://koky-backend-production.up.railway.app/api/production/debug-product/69')
.then(res => {
  console.log('DEBUG PRODUCT 69 RESPONSE:', JSON.stringify(res.data, null, 2));
})
.catch(err => {
  console.error('ERROR:', err.response?.data || err.message);
});
