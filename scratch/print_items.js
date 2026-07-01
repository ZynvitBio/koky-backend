const axios = require('axios');

axios.get('https://koky-backend-production.up.railway.app/api/production/debug-orders')
.then(res => {
  const latestOrder = res.data.orders[0];
  console.log('ORDER ID:', latestOrder.id);
  console.log('ITEMS JSON:', latestOrder.items);
})
.catch(err => {
  console.error('ERROR:', err.response?.data || err.message);
});
