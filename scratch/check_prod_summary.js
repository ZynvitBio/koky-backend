const axios = require('axios');

axios.get('https://koky-backend-production.up.railway.app/api/production/summary?date=2026-07-02')
.then(res => {
  console.log('PRODUCTION SUMMARY:', JSON.stringify(res.data, null, 2));
})
.catch(err => {
  console.error('ERROR:', err.response?.data || err.message);
});
