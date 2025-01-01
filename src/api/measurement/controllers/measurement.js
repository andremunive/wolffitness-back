"use strict";

/**
 * measurement controller
 */

// @ts-ignore
const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::measurement.measurement",
  ({ strapi }) => ({
    async lastThree(ctx) {
      const { clientId } = ctx.params; // Obtén el id del cliente desde los parámetros de la ruta

      const paymentRecords = await strapi.entityService.findMany(
        "api::measurement.measurement",
        {
          filters: { client: clientId }, // Filtrar por el cliente
          sort: { createdAt: "desc" }, // Ordenar por fecha de creación (más reciente primero)
          limit: 3, // Limitar a los últimos 3 registros
        }
      );

      return this.transformResponse(paymentRecords);
    },
  })
);
