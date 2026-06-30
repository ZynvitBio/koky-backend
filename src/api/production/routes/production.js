module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/production/summary',
      handler: 'production.getSummary',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/production/reconcile',
      handler: 'production.reconcile',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
