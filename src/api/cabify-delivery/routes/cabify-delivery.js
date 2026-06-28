// @ts-nocheck
"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/cabify-delivery/get-price",
      handler: "cabify-delivery.getPrice",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
