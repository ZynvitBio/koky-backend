const axios = require('axios');

axios.post('https://koky-backend-production.up.railway.app/api/cabify-delivery/get-price', {
  destino: { lat: 4.6533, lng: -74.0566 } // Bogotá coordinates
})
.then(res => {
  console.log('SUCCESS:', JSON.stringify(res.data, null, 2));
})
.catch(err => {
  console.error('ERROR status:', err.response?.status);
  console.error('ERROR body:', JSON.stringify(err.response?.data, null, 2));
});
