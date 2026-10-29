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
      method: "POST",
      path: "/orders/wompi-signature",
      handler: "order.generateWompiSignature",
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
    {
      method: "GET",
      path: "/orders/payment-link/:reference",
      handler: "order.getPaymentLinkByReference",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/orders/:id/send-invoice-email",
      handler: "order.sendInvoiceEmailManually",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
