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
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/cabify-delivery/cancel-parcel",
      handler: "cabify-delivery.cancelParcel",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/cabify-delivery/parcel-status/:parcelId",
      handler: "cabify-delivery.getParcelStatus",
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/cabify-delivery/webhook",
      handler: "cabify-delivery.webhook",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
