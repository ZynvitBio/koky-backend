"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/orders/wompi-webhook",
      handler: "order.wompiWebhook",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
