"use strict";

/**
 * payment-record controller
 */

// @ts-ignore
const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::payment-record.payment-record",
  ({ strapi }) => ({
    async lastThree(ctx) {
      const { clientId } = ctx.params; // Obtén el id del cliente desde los parámetros de la ruta

      const paymentRecords = await strapi.entityService.findMany(
        "api::payment-record.payment-record",
        {
          filters: { client: clientId }, // Filtrar por el cliente
          sort: { createdAt: "desc" }, // Ordenar por fecha de creación (más reciente primero)
          limit: 3, // Limitar a los últimos 3 registros
        }
      );

      return this.transformResponse(paymentRecords);
    },
    async byTrainer(ctx) {
      try {
        const { trainer } = ctx.params;
        const clients = await strapi.entityService.findMany(
          "api::client.client",
          {
            filters: { trainer },
            fields: ["id"], // Solo necesitamos los IDs de los clientes
          }
        );
        if (!clients.length) {
          return ctx.notFound(
            "No se encontraron clientes para este entrenador"
          );
        }

        const clientIds = clients.map((client) => client.id);

        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              client: {
                id: { $in: clientIds }, // Filtrar por IDs de los clientes
              },
            },
            populate: ["client"], // Opcional: incluye los datos del cliente relacionado
          }
        );

        return this.transformResponse(paymentRecords);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al obtener los registros de pago"
        );
      }
    },
    async getPaymentSummaryByTrainer(ctx) {
      try {
        const { trainer, months } = ctx.params;

        // Obtener clientes asociados al entrenador
        const clients = await strapi.entityService.findMany(
          "api::client.client",
          {
            filters: { trainer },
            fields: ["id"], // Solo necesitamos los IDs de los clientes
          }
        );

        if (!clients.length) {
          return ctx.notFound(
            "No se encontraron clientes para este entrenador"
          );
        }

        // Extraer los IDs de los clientes
        const clientIds = clients.map((client) => client.id);

        // Obtener fecha de inicio y fin de los últimos tres meses
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
        threeMonthsAgo.setDate(1); // Inicio del primer mes

        // Buscar registros de pagos en los últimos tres meses
        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              client: {
                id: { $in: clientIds }, // Filtrar por clientes
              },
              paymentDate: {
                $gte: threeMonthsAgo.toISOString(), // Desde hace tres meses
                $lte: now.toISOString(), // Hasta hoy
              },
            },
          }
        );

        if (!paymentRecords.length) {
          return ctx.notFound(
            "No se encontraron registros de pagos en los últimos tres meses"
          );
        }

        // Procesar los datos
        const paymentSummary = {};

        for (let i = 0; i < months; i++) {
          const month = new Date();
          month.setMonth(now.getMonth() - i);
          const year = month.getFullYear();
          const monthNumber = month.getMonth() + 1; // Mes 1-indexado
          const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
          const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
          const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
          const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

          const firstHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return paymentDate >= startFirstHalf && paymentDate <= endFirstHalf;
          });

          const secondHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            return (
              paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
            );
          });

          const calculateCollected = (payments) => {
            return payments.reduce((sum, payment) => {
              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              const reason = payment.discountReason;

              if (payment.hasDiscounted) {
                if (reason === "Promocion") {
                  return sum + (amount - discount) / 2;
                } else if (reason === "Personal") {
                  return sum + amount / 2 - discount;
                }
              }

              return sum + amount;
            }, 0);
          };

          const calculateGenerated = (payments) => {
            return payments.reduce((sum, payment) => {
              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;

              if (payment.hasDiscounted) {
                const reason = payment.discountReason;
                if (reason === "Promocion") {
                  return sum + (amount - discount) / 2;
                } else if (reason === "Personal") {
                  return sum + amount / 2 - discount;
                }
              }

              return sum + amount / 2;
            }, 0);
          };

          const calculatePlanCounts = (payments) => {
            return payments.reduce(
              (counts, payment) => {
                if (payment.plan === "3 dias") {
                  if (payment.status === "pending") {
                    counts.pending["3 dias"] += 1;
                  } else if (payment.status === "paid") {
                    counts.actives["3 dias"] += 1;
                  }
                } else if (payment.plan === "6 dias") {
                  if (payment.status === "pending") {
                    counts.pending["6 dias"] += 1;
                  } else if (payment.status === "paid") {
                    counts.actives["6 dias"] += 1;
                  }
                }
                return counts;
              },
              {
                pending: { "3 dias": 0, "6 dias": 0 },
                actives: { "3 dias": 0, "6 dias": 0 },
              }
            );
          };

          paymentSummary[`${year}-${monthNumber}`] = {
            firstHalf: {
              totalClients: firstHalfPayments.length,
              totalCollected: calculateCollected(firstHalfPayments), // Total recolectado (sin dividir en dos)
              totalGenerated: calculateGenerated(firstHalfPayments), // Total generado con reglas específicas
              planCounts: calculatePlanCounts(firstHalfPayments), // Totales por plan
            },
            secondHalf: {
              totalClients: secondHalfPayments.length,
              totalCollected: calculateCollected(secondHalfPayments), // Total recolectado (sin dividir en dos)
              totalGenerated: calculateGenerated(secondHalfPayments), // Total generado con reglas específicas
              planCounts: calculatePlanCounts(secondHalfPayments), // Totales por plan
            },
          };
        }

        // Retornar el resumen
        return this.transformResponse(paymentSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
    async getPaymentSummaryForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener la lista de entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["name"], // Solo necesitamos el nombre de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }

        const paymentSummaries = {};

        // Iterar sobre cada entrenador y procesar su resumen
        for (const trainer of trainers) {
          const trainerName = trainer.name;

          // Obtener clientes asociados al entrenador
          const clients = await strapi.entityService.findMany(
            "api::client.client",
            {
              filters: { trainer: trainerName },
              fields: ["id"], // Solo necesitamos los IDs de los clientes
            }
          );

          if (!clients.length) {
            paymentSummaries[trainerName] = {
              message: "No se encontraron clientes para este entrenador",
            };
            continue;
          }

          // Extraer los IDs de los clientes
          const clientIds = clients.map((client) => client.id);

          // Obtener fecha de inicio y fin de los últimos tres meses
          const now = new Date();
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - (months - 1));
          threeMonthsAgo.setDate(1); // Inicio del primer mes

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                client: {
                  id: { $in: clientIds }, // Filtrar por clientes
                },
                paymentDate: {
                  $gte: threeMonthsAgo.toISOString(), // Desde hace tres meses
                  $lte: now.toISOString(), // Hasta hoy
                },
              },
            }
          );

          if (!paymentRecords.length) {
            paymentSummaries[trainerName] = {
              message:
                "No se encontraron registros de pagos para este entrenador",
            };
            continue;
          }

          // Procesar los datos del entrenador
          const paymentSummary = {};

          for (let i = 0; i < months; i++) {
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1; // Mes 1-indexado
            const startFirstHalf = new Date(year, monthNumber - 1, 1); // Inicio 1ra quincena
            const endFirstHalf = new Date(year, monthNumber - 1, 15); // Fin 1ra quincena
            const startSecondHalf = new Date(year, monthNumber - 1, 16); // Inicio 2da quincena
            const endSecondHalf = new Date(year, monthNumber, 0); // Fin del mes

            const firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startFirstHalf && paymentDate <= endFirstHalf
              );
            });

            const secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              return (
                paymentDate >= startSecondHalf && paymentDate <= endSecondHalf
              );
            });

            const calculateCollected = (payments) => {
              return payments.reduce((sum, payment) => {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                const reason = payment.discountReason;

                if (payment.hasDiscounted) {
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }

                return sum + amount;
              }, 0);
            };

            const calculateGenerated = (payments) => {
              return payments.reduce((sum, payment) => {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (payment.hasDiscounted) {
                  const reason = payment.discountReason;
                  if (reason === "Promocion") {
                    return sum + (amount - discount) / 2;
                  } else if (reason === "Personal") {
                    return sum + amount / 2 - discount;
                  }
                }

                return sum + amount / 2;
              }, 0);
            };

            const calculatePlanCounts = (payments) => {
              return payments.reduce(
                (counts, payment) => {
                  if (payment.plan === "3 dias") {
                    if (payment.status === "pending") {
                      counts.pending["3 dias"] += 1;
                    } else if (payment.status === "paid") {
                      counts.actives["3 dias"] += 1;
                    }
                  } else if (payment.plan === "6 dias") {
                    if (payment.status === "pending") {
                      counts.pending["6 dias"] += 1;
                    } else if (payment.status === "paid") {
                      counts.actives["6 dias"] += 1;
                    }
                  }
                  return counts;
                },
                {
                  pending: { "3 dias": 0, "6 dias": 0 },
                  actives: { "3 dias": 0, "6 dias": 0 },
                }
              );
            };

            paymentSummary[`${year}-${monthNumber}`] = {
              firstHalf: {
                totalClients: firstHalfPayments.length,
                totalCollected: calculateCollected(firstHalfPayments),
                totalGenerated: calculateGenerated(firstHalfPayments),
                planCounts: calculatePlanCounts(firstHalfPayments),
              },
              secondHalf: {
                totalClients: secondHalfPayments.length,
                totalCollected: calculateCollected(secondHalfPayments),
                totalGenerated: calculateGenerated(secondHalfPayments),
                planCounts: calculatePlanCounts(secondHalfPayments),
              },
            };
          }

          // Agregar el resumen del entrenador al objeto principal
          paymentSummaries[trainerName] = paymentSummary;
        }

        // Retornar el resumen de todos los entrenadores
        return this.transformResponse(paymentSummaries);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
  })
);
