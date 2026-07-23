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
        await strapi.documents("api::order.order").publish({
          documentId: result.documentId,
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
 * - Lunes a Jueves: pedidos antes de las 16:00 (4:00 PM) se entregan mañana (D+1). Pedidos después de las 16:00 se entregan el día después (D+2). Si cae en sábado, se pasa al lunes.
 */
function calculateDeliveryDate(createdAtDate) {
  // Convertir a la hora de Bogotá para asegurar consistencia
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(new Date(createdAtDate));
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
  const day = parseInt(parts.find(p => p.type === 'day').value);
  const hour = parseInt(parts.find(p => p.type === 'hour').value);

  const bogotaDate = new Date(year, month, day, hour);
  const dayOfWeek = bogotaDate.getDay(); // 0 = Dom, 1 = Lun, ...

  // Lista de feriados de Colombia (formato YYYY-MM-DD)
  const COLOMBIAN_HOLIDAYS = [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
    '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
    '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
    '2026-11-16', '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26',
    '2027-05-01', '2027-05-10', '2027-05-31', '2027-06-07', '2027-06-21',
    '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18',
    '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25'
  ];

  const isHoliday = (dateToCheck) => {
    const y = dateToCheck.getFullYear();
    const m = String(dateToCheck.getMonth() + 1).padStart(2, '0');
    const d = String(dateToCheck.getDate()).padStart(2, '0');
    return COLOMBIAN_HOLIDAYS.includes(`${y}-${m}-${d}`);
  };

  const isWeekend = (dateToCheck) => {
    const d = dateToCheck.getDay();
    return d === 0 || d === 6;
  };

  let targetDate = new Date(bogotaDate);

  // Determinamos la ventana del fin de semana largo (Jueves 4:00 PM al Domingo 4:00 PM)
  const isWeekendWindow = 
    (dayOfWeek === 4 && hour >= 16) || // Jueves después de las 4 PM
    (dayOfWeek === 5) ||               // Viernes todo el día
    (dayOfWeek === 6) ||               // Sábado todo el día
    (dayOfWeek === 0 && hour < 16);    // Domingo antes de las 4 PM

  if (isWeekendWindow) {
    // Pedidos en ventana de fin de semana se entregan el lunes inicialmente
    const daysToAdd = dayOfWeek === 4 ? 4 : (dayOfWeek === 5 ? 3 : (dayOfWeek === 6 ? 2 : 1));
    targetDate.setDate(bogotaDate.getDate() + daysToAdd);
  } else if (dayOfWeek === 0 && hour >= 16) {
    // Domingo después de las 4:00 PM se entrega el martes inicialmente
    targetDate.setDate(bogotaDate.getDate() + 2);
  } else {
    // Caso estándar de lunes a jueves
    if (hour < 16) {
      targetDate.setDate(bogotaDate.getDate() + 1); // Entrega mañana
    } else {
      targetDate.setDate(bogotaDate.getDate() + 2); // Entrega pasado mañana
    }
  }

  // Bucle para saltar fines de semana y festivos
  while (isWeekend(targetDate) || isHoliday(targetDate)) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
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
        await strapi.documents("api::product.product").publish({
          documentId: product.documentId,
        });
      }
    } catch (err) {
      strapi.log.error(
        `[Stock Deduction] Error al descontar stock del producto id ${item.id}: ${err.message}`
      );
    }
  }
}
