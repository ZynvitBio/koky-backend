module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/whatsapp/webhook',
      handler: 'whatsapp.verify',
      config: { auth: false },
    },
    {
      method: 'POST', // Meta usa POST para enviarte los mensajes
      path: '/whatsapp/webhook',
      handler: 'whatsapp.receive',
      config: { auth: false },
    },
  ],
};