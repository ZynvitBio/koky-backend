'use strict';

/**
 * google-review service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::google-review.google-review');
