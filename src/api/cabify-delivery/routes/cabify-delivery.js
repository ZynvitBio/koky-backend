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
    {
      method: "POST",
      path: "/cabify-delivery/create-parcel",
      handler: "cabify-delivery.createParcel",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
