module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/production/summary',
      handler: 'production.getSummary',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/production/reconcile',
      handler: 'production.reconcile',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
