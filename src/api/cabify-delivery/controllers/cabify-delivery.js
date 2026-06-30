// @ts-nocheck
"use strict";

module.exports = {
  /**
   * Obtiene la estimación de precio para un envío de Cabify.
   * Recibe el destino desde el frontend (Angular).
   */
  async getPrice(ctx) {
    try {
      const { destino } = ctx.request.body;

      if (!destino || !destino.lat || !destino.lng) {
        throw new Error("Coordenadas de destino no recibidas correctamente.");
      }

      // Preparamos el objeto usando el destino dinámico
      const parcelData = {
        pickup_location: { lat: 4.6976, lon: -74.0617 }, // Ubicación fija de Koky Kitchen
        dropoff_location: { lat: destino.lat, lon: destino.lng },
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      };

      // Llamamos al servicio centralizado
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getPriceEstimate(parcelData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async createParcel(ctx) {
    try {
      const { deliveryData } = ctx.request.body;

      if (
        !deliveryData ||
        !deliveryData.dropoff_address ||
        !deliveryData.dropoff_location ||
        !deliveryData.customer_name ||
        !deliveryData.customer_phone
      ) {
        throw new Error("Datos de entrega incompletos.");
      }

      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .createAndDeliverParcel(deliveryData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async cancelParcel(ctx) {
    try {
      const { parcelId, documentId } = ctx.request.body;

      if (!parcelId) {
        throw new Error("ID de paquete no recibido.");
      }

      // 1. Cancelar en Cabify
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .cancelParcel(parcelId);

      // 2. Si se pasó documentId, actualizar la orden en Strapi para quitar el ID de Cabify
      if (documentId) {
        await strapi.entityService.update("api::order.order", documentId, {
          data: {
            cabify_parcel_id: null,
          },
        });
      }

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  async getParcelStatus(ctx) {
    try {
      const { parcelId } = ctx.params;

      if (!parcelId) {
        throw new Error("ID de paquete no recibido.");
      }

      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getParcelStatus(parcelId);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};
