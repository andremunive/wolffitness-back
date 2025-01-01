'use strict';

/**
 * payment-record service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::payment-record.payment-record');
