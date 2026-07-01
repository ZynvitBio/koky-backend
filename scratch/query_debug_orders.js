const axios = require('axios');

axios.get('https://koky-backend-production.up.railway.app/api/production/debug-orders')
.then(res => {
  console.log('LATEST 10 ORDERS FROM PRODUCTION:');
  res.data.orders.forEach(o => {
    console.log(`ID: ${o.id}, Customer: ${o.customer_name}, DeliveryDate: ${o.delivery_date}, PublishedAt: ${o.publishedAt}, Reconciled: ${o.reconciled}`);
  });
})
.catch(err => {
  console.error('ERROR:', err.response?.data || err.message);
});
