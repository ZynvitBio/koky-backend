"use strict";

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // Solo creamos el envío en Cabify si tiene dirección, coordenadas y aún no tiene un parcel ID asignado
    if (
      result.shipping_address &&
      result.shipping_latitude &&
      result.shipping_longitude &&
      !result.cabify_parcel_id
    ) {
      try {
        const deliveryData = {
          dropoff_address: result.shipping_address,
          dropoff_location: {
            lat: parseFloat(result.shipping_latitude),
            lon: parseFloat(result.shipping_longitude),
          },
          customer_name: result.customer_name || "Cliente Koky",
          customer_phone: result.whatsapp_id,
          notes: result.shipping_notes || "",
          external_id: "KOKY_ORDER_" + result.id,
        };

        // Llamamos al servicio de cabify-delivery
        const cabifyResult = await strapi
          .service("api::cabify-delivery.cabify-delivery")
          .createAndDeliverParcel(deliveryData);

        // Guardamos el ID del paquete en la orden usando la API de documentos de Strapi 5
        await strapi.documents("api::order.order").update({
          documentId: result.documentId,
          data: {
            cabify_parcel_id: cabifyResult.parcelId,
          },
        });

        strapi.log.info(
          `Envío de Cabify programado con éxito para la orden ${result.id}. Parcel ID: ${cabifyResult.parcelId}`,
        );
      } catch (err) {
        strapi.log.error(
          `Error al programar envío en Cabify para la orden ${result.id}: ${err.message}`,
        );
      }
    }
  },
};
