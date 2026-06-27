// @ts-nocheck
"use strict";

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/cabify-delivery/test-cabify", // Actualizado
      handler: "cabify-delivery.testConnection", // Actualizado (nombre de archivo.nombre de método)
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/cabify-delivery/test-create-shipment", // Actualizado
      handler: "cabify-delivery.testCreateShipment", // Actualizado
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/cabify-delivery/test-estimate", // Actualizado
      handler: "cabify-delivery.testEstimate", // Actualizado
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: "POST",
      path: "/cabify-delivery/get-price", // Actualizado
      handler: "cabify-delivery.getPrice", // Actualizado
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
