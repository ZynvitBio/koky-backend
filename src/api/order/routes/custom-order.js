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
    {
      method: "GET",
      path: "/orders/confirm/:reference",
      handler: "order.getConfirmationDetails",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
