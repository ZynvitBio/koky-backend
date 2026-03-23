'use strict';

/**
 * batch service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::batch.batch');
