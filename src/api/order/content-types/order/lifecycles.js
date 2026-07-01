"use strict";

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    // Asignar automáticamente la fecha de entrega (delivery_date) si no viene definida
    if (!data.delivery_date) {
      data.delivery_date = calculateDeliveryDate(new Date());
      strapi.log.info(`[Lifecycle Order] Fecha de entrega calculada en beforeCreate: ${data.delivery_date}`);
    }
  },

  async afterUpdate(event) {
    const { result, params } = event;
    const { data } = params;

    // Detectamos si el campo cabify_parcel_id está siendo actualizado y el stock no se ha descontado aún
    if (data && data.cabify_parcel_id && result && result.cabify_parcel_id && !result.stock_deducted) {
      try {
        strapi.log.info(`[Lifecycle Order] Descontando stock para la orden ID: ${result.id}`);
        await deductOrderStock(result);

        // Marcamos la orden con stock_deducted = true para no repetir el proceso
        await strapi.documents("api::order.order").update({
          documentId: result.documentId,
          data: {
            stock_deducted: true,
          },
        });
        strapi.log.info(`[Lifecycle Order] Stock marcado como descontado para la orden ID: ${result.id}`);
      } catch (err) {
        strapi.log.error(`[Lifecycle Order] Error al descontar stock en afterUpdate: ${err.message}`);
      }
    }
  },

  async afterCreate(event) {
    const { result } = event;

    strapi.log.info(
      `[Lifecycle Order] afterCreate ejecutado para la orden ID: ${result.id}, DocumentID: ${result.documentId}`
    );
  },
};

/**
 * Calcula la fecha de entrega según las reglas de negocio de Koky:
 * - Despachos de lunes a viernes.
 * - Sábado y Domingo no hay entregas, todos los pedidos de viernes, sábado y domingo se entregan el lunes.
 * - Lunes a Jueves: pedidos antes de las 18:00 (6:00 PM) se entregan mañana (D+1). Pedidos después de las 18:00 se entregan el día después (D+2). Si cae en sábado, se pasa al lunes.
 */
function calculateDeliveryDate(createdAtDate) {
  const date = new Date(createdAtDate);
  const hour = date.getHours();
  const day = date.getDay(); // 0 = Dom, 1 = Lun, ..., 5 = Vie, 6 = Sáb

  let deliveryDate = new Date(date);

  if (day === 5) { // Viernes
    deliveryDate.setDate(date.getDate() + 3); // Entrega el Lunes
  } else if (day === 6) { // Sábado
    deliveryDate.setDate(date.getDate() + 2); // Entrega el Lunes
  } else if (day === 0) { // Domingo
    deliveryDate.setDate(date.getDate() + 1); // Entrega el Lunes
  } else { // Lunes a Jueves
    if (hour < 18) { // Antes de las 6 PM
      deliveryDate.setDate(date.getDate() + 1); // Entrega mañana
    } else { // Después de las 6 PM
      deliveryDate.setDate(date.getDate() + 2); // Entrega pasado mañana
      if (deliveryDate.getDay() === 6) { // Si cae sábado, mover al lunes
        deliveryDate.setDate(deliveryDate.getDate() + 2);
      }
    }
  }

  const yyyy = deliveryDate.getFullYear();
  const mm = String(deliveryDate.getMonth() + 1).padStart(2, '0');
  const dd = String(deliveryDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Descuenta el stock de los productos incluidos en la orden.
 * Si el item indica que fue comprado como "Disponible Hoy" (availableToday), descuenta de immediateDeliveryStock.
 * De lo contrario, descuenta de stock regular.
 */
async function deductOrderStock(order) {
  if (!order || !order.items) return;

  let items = order.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (e) {
      strapi.log.error(`[Stock Deduction] Error al parsear items: ${e.message}`);
      return;
    }
  }

  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!item.id) continue;

    try {
      // Buscar el producto por id numérico usando db.query
      const product = await strapi.db.query("api::product.product").findOne({
        where: {
          id: item.id,
        },
      });

      if (product) {
        const qty = Number(item.quantity) || 0;
        let updateData = {};

        if (item.availableToday === true) {
          // Descontar de Tofu Express (Disponible Hoy)
          const newImmediateStock = Math.max(0, (product.immediateDeliveryStock || 0) - qty);
          updateData = { immediateDeliveryStock: newImmediateStock };
          strapi.log.info(
            `[Stock] Producto ${product.name} (Express) stock anterior: ${product.immediateDeliveryStock}, nuevo: ${newImmediateStock}`
          );
        } else {
          // Descontar de stock regular
          const newStock = Math.max(0, (product.stock || 0) - qty);
          updateData = { stock: newStock };
          strapi.log.info(
            `[Stock] Producto ${product.name} regular stock anterior: ${product.stock}, nuevo: ${newStock}`
          );
        }

        // Actualizar en Strapi
        await strapi.documents("api::product.product").update({
          documentId: product.documentId,
          data: updateData,
        });
      }
    } catch (err) {
      strapi.log.error(
        `[Stock Deduction] Error al descontar stock del producto id ${item.id}: ${err.message}`
      );
    }
  }
}
