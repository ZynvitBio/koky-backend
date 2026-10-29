'use strict';

/**
 * Retorna el conjunto de festivos en Colombia para un año específico (en formato YYYY-MM-DD),
 * calculando festivos fijos, festivos trasladados por la Ley Emiliani (Ley 51 de 1983)
 * y festivos calculados por el domingo de Pascua (algoritmo Butcher-Oudin).
 */
function getColombianHolidays(year) {
  const holidays = new Set();

  // 1. Festivos Fijos (No se trasladan por ley)
  holidays.add(`${year}-01-01`); // Año Nuevo
  holidays.add(`${year}-05-01`); // Día del Trabajo
  holidays.add(`${year}-07-20`); // Grito de Independencia
  holidays.add(`${year}-08-07`); // Batalla de Boyacá
  holidays.add(`${year}-12-08`); // Inmaculada Concepción
  holidays.add(`${year}-12-25`); // Navidad

  // Helper para mover al siguiente lunes si no cae lunes (Ley Emiliani)
  const getNextMondayStr = (month, day) => {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
    if (dayOfWeek === 1) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    date.setDate(date.getDate() + daysToAdd);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 2. Festivos con fecha fija que se trasladan al siguiente lunes (Ley Emiliani)
  holidays.add(getNextMondayStr(1, 6));   // Epifanía / Reyes Magos (6 de Enero)
  holidays.add(getNextMondayStr(3, 19));  // San José (19 de Marzo)
  holidays.add(getNextMondayStr(6, 29));  // San Pedro y San Pablo (29 de Junio)
  holidays.add(getNextMondayStr(7, 9));   // Virgen de Chiquinquirá (9 de Julio - Ley 2578)
  holidays.add(getNextMondayStr(8, 15));  // Asunción de la Virgen (15 de Agosto)
  holidays.add(getNextMondayStr(10, 12)); // Día de la Raza (12 de Octubre)
  holidays.add(getNextMondayStr(11, 1));  // Todos los Santos (1 de Noviembre)
  holidays.add(getNextMondayStr(11, 11)); // Independencia de Cartagena (11 de Noviembre)

  // 3. Festivos basados en la Pascua (Algoritmo Butcher-Oudin para Domingo de Resurrección)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;

  const easter = new Date(year, month - 1, day);

  const addDaysStr = (baseDate, days) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + days);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  holidays.add(addDaysStr(easter, -3)); // Jueves Santo
  holidays.add(addDaysStr(easter, -2)); // Viernes Santo
  holidays.add(addDaysStr(easter, 43)); // Ascensión del Señor (trasladado a lunes)
  holidays.add(addDaysStr(easter, 64)); // Corpus Christi (trasladado a lunes)
  holidays.add(addDaysStr(easter, 71)); // Sagrado Corazón de Jesús (trasladado a lunes)

  return holidays;
}

/**
 * Retorna true si una fecha corresponde a fin de semana (sábado o domingo) o festivo en Colombia.
 */
function isWeekendOrHoliday(dateObj) {
  const dayOfWeek = dateObj.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return true; // Domingo o Sábado
  }
  const year = dateObj.getFullYear();
  const holidays = getColombianHolidays(year);
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}-${m}-${d}`;
  return holidays.has(dateStr);
}

/**
 * Calcula con precisión los horarios de producción en cocina y entrega en Bogotá,
 * respetando el corte de las 8:00 PM, fines de semana, festivos fijos y Ley Emiliani.
 *
 * @param {Date|string} dateInput - Fecha y hora del pedido
 * @returns {{ productionNight: string, deliveryDay: string, deliveryDateStr: string }}
 */
function getDeliverySchedule(dateInput) {
  const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());

  // Formatear en la zona horaria oficial de Bogotá (America/Bogota, UTC-5)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const getVal = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

  const year = getVal('year');
  const month = getVal('month') - 1; // 0-11
  const day = getVal('day');
  const hour = getVal('hour');

  const bogotaNow = new Date(year, month, day, hour);

  // Buscar el próximo día hábil de entrega disponible
  let deliveryDate = new Date(year, month, day);
  deliveryDate.setDate(deliveryDate.getDate() + 1);

  while (true) {
    if (!isWeekendOrHoliday(deliveryDate)) {
      // Hora límite de corte: 8:00 PM (20:00) del día anterior a la entrega
      const cutoffDate = new Date(deliveryDate);
      cutoffDate.setDate(deliveryDate.getDate() - 1);
      cutoffDate.setHours(20, 0, 0, 0);

      if (bogotaNow.getTime() < cutoffDate.getTime()) {
        break;
      }
    }
    deliveryDate.setDate(deliveryDate.getDate() + 1);
  }

  // La noche de producción es la noche previa al día de entrega
  const prodDate = new Date(deliveryDate);
  prodDate.setDate(deliveryDate.getDate() - 1);

  // Días transcurridos entre hoy (Bogotá) y el día de entrega
  const todayMidnight = new Date(year, month, day);
  const deliveryMidnight = new Date(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate());
  const diffDays = Math.round((deliveryMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));

  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  const deliveryDayName = dayNames[deliveryDate.getDay()];
  const prodDayName = dayNames[prodDate.getDay()];

  let productionNight = '';
  let deliveryDay = '';

  if (diffDays === 1) {
    // La entrega es mañana mismo (pedido antes de las 8 PM en día hábil)
    productionNight = 'esta misma noche';
    deliveryDay = `mañana mismo (${deliveryDayName})`;
  } else if (diffDays === 2 && hour >= 20) {
    // Pedido después de las 8 PM para pasado mañana
    productionNight = 'mañana por la noche';
    deliveryDay = `pasado mañana (${deliveryDayName})`;
  } else {
    // Pedidos en fin de semana, festivo o con puente
    if (prodDate.getDate() === todayMidnight.getDate() && prodDate.getMonth() === todayMidnight.getMonth()) {
      productionNight = 'esta misma noche';
    } else {
      productionNight = `el ${prodDayName} por la noche`;
    }
    deliveryDay = `el próximo ${deliveryDayName} (${deliveryDate.getDate()} de ${monthNames[deliveryDate.getMonth()]})`;
  }

  const deliveryDateStr = `${deliveryDate.getFullYear()}-${String(deliveryDate.getMonth() + 1).padStart(2, '0')}-${String(deliveryDate.getDate()).padStart(2, '0')}`;

  return {
    productionNight,
    deliveryDay,
    deliveryDateStr,
    deliveryDate,
  };
}

module.exports = {
  getColombianHolidays,
  isWeekendOrHoliday,
  getDeliverySchedule,
};
