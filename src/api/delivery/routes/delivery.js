// @ts-nocheck
"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/delivery/test-cabify",
      handler: "delivery.testConnection",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/delivery/test-create-shipment",
      handler: "delivery.testCreateShipment",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/delivery/test-estimate",
      handler: "delivery.testEstimate",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/delivery/get-price",
      handler: "delivery.getPrice",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
