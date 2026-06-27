// @ts-nocheck
"use strict";

module.exports = {
  // 1. Corregido el servicio a 'api::cabify-delivery.cabify-delivery'
  async testConnection(ctx) {
    try {
      const result = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testConnection();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 2. Corregida la lógica de ejecución (faltaba el 'await' y el servicio estaba mal estructurado)
  async testEstimate(ctx) {
    try {
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testMyParcel();
      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 3. Corregido el servicio
  async testCreateShipment(ctx) {
    try {
      const result = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testCreateShipment();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 4. Corregido el servicio
  async getPrice(ctx) {
    try {
      // 1. Recibimos el objeto 'destino' desde el cuerpo del POST (Angular)
      const { destino } = ctx.request.body;

      if (!destino || !destino.lat || !destino.lng) {
        throw new Error("Coordenadas de destino no recibidas correctamente.");
      }

      // 2. Preparamos el objeto usando el destino dinámico
      const parcelData = {
        pickup_location: { lat: 4.6976, lon: -74.0617 },
        dropoff_location: { lat: destino.lat, lon: destino.lng }, // Aquí se usa el destino
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      };

      // 3. Llamamos al servicio
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getPriceEstimate(parcelData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};
