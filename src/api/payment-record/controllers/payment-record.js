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
    async getClientsSummaryForAllTrainers(ctx) {
      try {
        const { months } = ctx.params;

        // Obtener todos los entrenadores
        const trainers = await strapi.entityService.findMany(
          "api::trainer.trainer",
          {
            fields: ["id", "name"], // Solo necesitamos los id's de los entrenadores
          }
        );

        if (!trainers.length) {
          return ctx.notFound(
            "No se encontraron entrenadores en la base de datos"
          );
        }
        const clientSummary = {};
        for (const trainer of trainers) {
          const trainerId = trainer.id;
          const trainerName = trainer.name;
          // Obtener fecha de inicio y fin de los últimos meses
          const now = new Date();
          const monthsAgo = new Date();
          monthsAgo.setMonth(monthsAgo.getMonth() - months);
          monthsAgo.setDate(1); // Inicio del primer mes

          const endOfMonth = new Date();
          endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Último día del mes actual
          endOfMonth.setHours(23, 59, 59, 999);

          // Buscar registros de pagos en los últimos meses
          const paymentRecords = await strapi.entityService.findMany(
            "api::payment-record.payment-record",
            {
              filters: {
                trainer: trainerId,
                paymentDate: {
                  $gte: monthsAgo.toISOString(), // Desde el inicio de los meses
                  $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
                },
              },
            }
          );
          const accountSummary = {};
          // Funciones para hacer los calculos
          // Primera
          const calculateFortNightIncome = (payments, startDate, limitDate) => {
            return payments.reduce((sum, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              const paymentDate = new Date(payment.paymentDate);
              if (payment.currentPaymentStatus == "pending") return sum;
              if (receiptDate > limitDate) return sum;
              if (paymentDate < startDate) return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }

              return sum + amount;
            }, 0);
          };
          // Segunda
          const calculateXDayPlanTotalPayments = (
            payments,
            plan,
            limitDate
          ) => {
            return payments.reduce((count, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (payment.currentPaymentStatus == "pending") return count;
              if (receiptDate > limitDate) return count;

              if (payment.plan == `${plan} dias`) {
                count += 1;
              }
              return count;
            }, 0);
          };
          // Tercera
          const calculateXDayPlanTotalPending = (payments, plan, limitDate) => {
            return payments.reduce((count, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (receiptDate <= limitDate) {
                return count;
              }

              if (payment.plan == `${plan} dias`) {
                count += 1;
              }
              return count;
            }, 0);
          };
          // Cuarta
          const calculatePendingIncome = (payments, limitDate) => {
            return payments.reduce((sum, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              if (receiptDate <= limitDate) return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }
              return sum + amount;
            }, 0);
          };
          // Quinta
          const calculateIncomeFromLastFortNight = (payments) => {
            return payments.reduce((sum, payment) => {
              if (payment.currentPaymentStatus === "pending") return sum;
              const amount = parseFloat(payment.amount);
              if (payment.hasDiscounted) {
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;
                return sum + (amount - discount);
              }
              return sum + amount;
            }, 0);
          };
          // Sexta
          const calculateTrainerIncome = (
            currentFortNightPayment,
            previousFortNightPayments,
            startDate,
            limitDate
          ) => {
            const currentFortNightTrainerIncome =
              currentFortNightPayment.reduce((sum, payment) => {
                const receiptDate = payment.receiptDate
                  ? new Date(payment.receiptDate)
                  : undefined;
                const paymentDate = new Date(payment.paymentDate);
                if (payment.currentPaymentStatus == "pending") return sum;
                if (receiptDate > limitDate) return sum;
                if (paymentDate < startDate) return sum;
                const amount = parseFloat(payment.amount);
                if (payment.plan === "6 dias") {
                  if (payment.hasDiscounted) {
                    if (payment.discountReason === "Promocion") {
                      const discount = payment.discountAmount / 2;
                      return sum + (amount / 2 - discount);
                    } else {
                      const discount = payment.discountAmount;
                      return sum + (amount / 2 - discount);
                    }
                  } else {
                    return sum + amount / 2;
                  }
                } else {
                  if (payment.hasDiscounted) {
                    if (payment.discountReason === "Promocion") {
                      const discount = payment.discountAmount / 2;
                      return sum + (amount - 30000 - discount);
                    } else {
                      const discount = payment.discountAmount;
                      return sum + (amount - 30000 - discount);
                    }
                  } else {
                    return sum + amount - 30000;
                  }
                }
              }, 0);
            const incomeFromPreviousFortNight =
              previousFortNightPayments.reduce((sum, payment) => {
                if (payment.currentPaymentStatus === "pending") return sum;
                const amount = parseFloat(payment.amount);
                if (payment.plan === "6 dias") {
                  if (payment.hasDiscounted) {
                    if (payment.discountReason === "Promocion") {
                      const discount = payment.discountAmount / 2;
                      return sum + (amount / 2 - discount);
                    } else {
                      const discount = payment.discountAmount;
                      return sum + (amount / 2 - discount);
                    }
                  } else {
                    return sum + amount / 2;
                  }
                } else {
                  if (payment.hasDiscounted) {
                    if (payment.discountReason === "Promocion") {
                      const discount = payment.discountAmount / 2;
                      return sum + (amount - 30000 - discount);
                    } else {
                      const discount = payment.discountAmount;
                      return sum + (amount - 30000 - discount);
                    }
                  } else {
                    return sum + amount - 30000;
                  }
                }
              }, 0);
            return currentFortNightTrainerIncome + incomeFromPreviousFortNight;
          };
          // Septima
          const calculateBonus = (paymentsForBonus) => {
            let bonus = 0;
            let elegibleForBonus = 0;

            paymentsForBonus.forEach((payment) => {
              elegibleForBonus += 1;
              if (elegibleForBonus > 7) {
                const amount = parseFloat(payment.amount);
                const discount = payment.hasDiscounted
                  ? parseFloat(payment.discountAmount || 0)
                  : 0;

                if (!payment.hasDiscounted) {
                  bonus += amount / 2 - 40000;
                } else if (payment.discountReason === "Promocion") {
                  bonus += (amount - discount) / 2 - 40000;
                } else if (payment.discountReason === "Personal") {
                  bonus += amount / 2 - 40000;
                }
              }
            });
            return bonus;
          };
          for (let i = 0; i < months; i++) {
            let previousFirstHalfPayments = {};
            let previousSecondHalfPayments = {};
            let firstHalfPayments = {};
            let secondHalfPayments = {};
            let clientsForBonus = {};
            const month = new Date();
            month.setMonth(now.getMonth() - i);
            const year = month.getFullYear();
            const monthNumber = month.getMonth() + 1;
            const startFirstHalf = new Date(year, monthNumber - 1, 1);
            startFirstHalf.setUTCHours(0, 0, 0, 0);
            const endFirstHalf = new Date(year, monthNumber - 1, 15);
            endFirstHalf.setUTCHours(0, 0, 0, 0);
            const startSecondHalf = new Date(year, monthNumber - 1, 16);
            startSecondHalf.setUTCHours(0, 0, 0, 0);
            const endSecondHalf = new Date(year, monthNumber, 0);
            endSecondHalf.setUTCHours(0, 0, 0, 0);
            // Calculo para la quincena anterior
            const month2 = new Date();
            month2.setMonth(now.getMonth() - i - 1);
            const previousMonthNumber = month2.getMonth() + 1;
            const yearForPreviousMonth = month2.getFullYear();
            const startPreviousFirstHalf = new Date(year, monthNumber - 1, 1);
            startPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
            const endPreviousFirstHalf = new Date(year, monthNumber - 1, 15);
            endPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
            const startPreviousSecondHalf = new Date(
              yearForPreviousMonth,
              previousMonthNumber - 1,
              16
            );
            startPreviousSecondHalf.setUTCHours(0, 0, 0, 0);
            const endPreviousSecondHalf = new Date(
              yearForPreviousMonth,
              previousMonthNumber,
              0
            );
            endPreviousSecondHalf.setUTCHours(0, 0, 0, 0);

            previousFirstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                paymentDate >= startPreviousFirstHalf &&
                paymentDate <= endPreviousFirstHalf &&
                receiptDate >= startSecondHalf &&
                receiptDate <= endSecondHalf
              );
            });
            previousSecondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                paymentDate >= startPreviousSecondHalf &&
                paymentDate <= endPreviousSecondHalf &&
                receiptDate >= startFirstHalf &&
                receiptDate <= endFirstHalf
              );
            });
            firstHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                (paymentDate >= startFirstHalf &&
                  paymentDate <= endFirstHalf) ||
                (receiptDate >= startFirstHalf && receiptDate <= endFirstHalf)
              );
            });
            secondHalfPayments = paymentRecords.filter((payment) => {
              const paymentDate = new Date(payment.paymentDate);
              const receiptDate = new Date(payment.receiptDate);
              return (
                (paymentDate >= startSecondHalf &&
                  paymentDate <= endSecondHalf) ||
                (receiptDate >= startSecondHalf && receiptDate <= endSecondHalf)
              );
            });
            clientsForBonus = paymentRecords.filter((payment) => {
              const receiptDate = new Date(payment.receiptDate);
              const plan = payment.plan;
              return (
                receiptDate >= startFirstHalf &&
                receiptDate <= endSecondHalf &&
                plan === "6 dias"
              );
            });
            accountSummary[`${year}-${monthNumber}`] = {
              firstHalf: {
                fortNight: "Primera",
                sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  firstHalfPayments,
                  "6",
                  endFirstHalf
                ),
                sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  firstHalfPayments,
                  "6",
                  endFirstHalf
                ),
                threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  firstHalfPayments,
                  "3",
                  endFirstHalf
                ),
                threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  firstHalfPayments,
                  "3",
                  endFirstHalf
                ),
                fortNightIncome: calculateFortNightIncome(
                  firstHalfPayments,
                  startFirstHalf,
                  endFirstHalf
                ),
                pendinIncome: calculatePendingIncome(
                  firstHalfPayments,
                  endFirstHalf
                ),
                incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                  previousSecondHalfPayments
                ),
                grossIncome:
                  calculateFortNightIncome(
                    firstHalfPayments,
                    startFirstHalf,
                    endFirstHalf
                  ) +
                  calculateIncomeFromLastFortNight(previousSecondHalfPayments),
                trainerIncome: calculateTrainerIncome(
                  firstHalfPayments,
                  previousSecondHalfPayments,
                  startFirstHalf,
                  endFirstHalf
                ),
                monthBonus: calculateBonus(clientsForBonus),
              },
              secondHalf: {
                fortNight: "Segunda",
                sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  secondHalfPayments,
                  "6",
                  endSecondHalf
                ),
                sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  secondHalfPayments,
                  "6",
                  endSecondHalf
                ),
                threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                  secondHalfPayments,
                  "3",
                  endSecondHalf
                ),
                threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                  secondHalfPayments,
                  "3",
                  endSecondHalf
                ),
                fortNightIncome: calculateFortNightIncome(
                  secondHalfPayments,
                  startSecondHalf,
                  endSecondHalf
                ),
                pendinIncome: calculatePendingIncome(
                  secondHalfPayments,
                  endSecondHalf
                ),
                incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                  previousFirstHalfPayments
                ),
                grossIncome:
                  calculateFortNightIncome(
                    secondHalfPayments,
                    startSecondHalf,
                    endSecondHalf
                  ) +
                  calculateIncomeFromLastFortNight(previousFirstHalfPayments),
                trainerIncome: calculateTrainerIncome(
                  secondHalfPayments,
                  previousFirstHalfPayments,
                  startSecondHalf,
                  endSecondHalf
                ),
                monthBonus: calculateBonus(clientsForBonus),
              },
            };
            clientSummary[trainerName] = accountSummary;
          }
        }
        return this.transformResponse(clientSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
    async getClientsSummaryByTrainer(ctx) {
      try {
        const { trainerId, months } = ctx.params;

        const clientSummary = {};
        // Obtener fecha de inicio y fin de los últimos meses
        const now = new Date();
        const monthsAgo = new Date();
        monthsAgo.setMonth(monthsAgo.getMonth() - months);
        monthsAgo.setDate(1); // Inicio del primer mes

        const endOfMonth = new Date();
        endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Último día del mes actual
        endOfMonth.setHours(23, 59, 59, 999);

        // Buscar registros de pagos en los últimos meses
        const paymentRecords = await strapi.entityService.findMany(
          "api::payment-record.payment-record",
          {
            filters: {
              trainer: trainerId,
              paymentDate: {
                $gte: monthsAgo.toISOString(), // Desde el inicio de los meses
                $lte: endOfMonth.toISOString(), // Hasta el último día del mes actual
              },
            },
          }
        );
        // Funciones para hacer los calculos
        // Primera
        const calculateFortNightIncome = (payments, startDate, limitDate) => {
          return payments.reduce((sum, payment) => {
            const receiptDate = payment.receiptDate
              ? new Date(payment.receiptDate)
              : undefined;
            const paymentDate = new Date(payment.paymentDate);
            if (payment.currentPaymentStatus == "pending") return sum;
            if (receiptDate > limitDate) return sum;
            if (paymentDate < startDate) return sum;
            const amount = parseFloat(payment.amount);
            if (payment.hasDiscounted) {
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              return sum + (amount - discount);
            }

            return sum + amount;
          }, 0);
        };
        // Segunda
        const calculateXDayPlanTotalPayments = (payments, plan, limitDate) => {
          return payments.reduce((count, payment) => {
            const receiptDate = payment.receiptDate
              ? new Date(payment.receiptDate)
              : undefined;
            if (payment.currentPaymentStatus == "pending") return count;
            if (receiptDate > limitDate) return count;

            if (payment.plan == `${plan} dias`) {
              count += 1;
            }
            return count;
          }, 0);
        };
        // Tercera
        const calculateXDayPlanTotalPending = (payments, plan, limitDate) => {
          return payments.reduce((count, payment) => {
            const receiptDate = payment.receiptDate
              ? new Date(payment.receiptDate)
              : undefined;
            if (receiptDate <= limitDate) {
              return count;
            }

            if (payment.plan == `${plan} dias`) {
              count += 1;
            }
            return count;
          }, 0);
        };
        // Cuarta
        const calculatePendingIncome = (payments, limitDate) => {
          return payments.reduce((sum, payment) => {
            const receiptDate = payment.receiptDate
              ? new Date(payment.receiptDate)
              : undefined;
            if (receiptDate <= limitDate) return sum;
            const amount = parseFloat(payment.amount);
            if (payment.hasDiscounted) {
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              return sum + (amount - discount);
            }
            return sum + amount;
          }, 0);
        };
        // Quinta
        const calculateIncomeFromLastFortNight = (payments) => {
          return payments.reduce((sum, payment) => {
            if (payment.currentPaymentStatus === "pending") return sum;
            const amount = parseFloat(payment.amount);
            if (payment.hasDiscounted) {
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;
              return sum + (amount - discount);
            }
            return sum + amount;
          }, 0);
        };
        // Sexta
        const calculateTrainerIncome = (
          currentFortNightPayment,
          previousFortNightPayments,
          startDate,
          limitDate
        ) => {
          const currentFortNightTrainerIncome = currentFortNightPayment.reduce(
            (sum, payment) => {
              const receiptDate = payment.receiptDate
                ? new Date(payment.receiptDate)
                : undefined;
              const paymentDate = new Date(payment.paymentDate);
              if (payment.currentPaymentStatus == "pending") return sum;
              if (receiptDate > limitDate) return sum;
              if (paymentDate < startDate) return sum;
              const amount = parseFloat(payment.amount);
              if (payment.plan === "6 dias") {
                if (payment.hasDiscounted) {
                  if (payment.discountReason === "Promocion") {
                    const discount = payment.discountAmount / 2;
                    return sum + (amount / 2 - discount);
                  } else {
                    const discount = payment.discountAmount;
                    return sum + (amount / 2 - discount);
                  }
                } else {
                  return sum + amount / 2;
                }
              } else {
                if (payment.hasDiscounted) {
                  if (payment.discountReason === "Promocion") {
                    const discount = payment.discountAmount / 2;
                    return sum + (amount - 30000 - discount);
                  } else {
                    const discount = payment.discountAmount;
                    return sum + (amount - 30000 - discount);
                  }
                } else {
                  return sum + amount - 30000;
                }
              }
            },
            0
          );
          const incomeFromPreviousFortNight = previousFortNightPayments.reduce(
            (sum, payment) => {
              if (payment.currentPaymentStatus === "pending") return sum;
              const amount = parseFloat(payment.amount);
              if (payment.plan === "6 dias") {
                if (payment.hasDiscounted) {
                  if (payment.discountReason === "Promocion") {
                    const discount = payment.discountAmount / 2;
                    return sum + (amount / 2 - discount);
                  } else {
                    const discount = payment.discountAmount;
                    return sum + (amount / 2 - discount);
                  }
                } else {
                  return sum + amount / 2;
                }
              } else {
                if (payment.hasDiscounted) {
                  if (payment.discountReason === "Promocion") {
                    const discount = payment.discountAmount / 2;
                    return sum + (amount - 30000 - discount);
                  } else {
                    const discount = payment.discountAmount;
                    return sum + (amount - 30000 - discount);
                  }
                } else {
                  return sum + amount - 30000;
                }
              }
            },
            0
          );
          return currentFortNightTrainerIncome + incomeFromPreviousFortNight;
        };
        // Septima
        const calculateBonus = (paymentsForBonus) => {
          let bonus = 0;
          let elegibleForBonus = 0;

          paymentsForBonus.forEach((payment) => {
            elegibleForBonus += 1;
            if (elegibleForBonus > 7) {
              const amount = parseFloat(payment.amount);
              const discount = payment.hasDiscounted
                ? parseFloat(payment.discountAmount || 0)
                : 0;

              if (!payment.hasDiscounted) {
                bonus += amount / 2 - 40000;
              } else if (payment.discountReason === "Promocion") {
                bonus += (amount - discount) / 2 - 40000;
              } else if (payment.discountReason === "Personal") {
                bonus += amount / 2 - 40000;
              }
            }
          });
          return bonus;
        };
        for (let i = 0; i < months; i++) {
          let previousFirstHalfPayments = {};
          let previousSecondHalfPayments = {};
          let firstHalfPayments = {};
          let secondHalfPayments = {};
          let clientsForBonus = {};
          const month = new Date();
          month.setMonth(now.getMonth() - i);
          const year = month.getFullYear();
          const monthNumber = month.getMonth() + 1;
          const startFirstHalf = new Date(year, monthNumber - 1, 1);
          startFirstHalf.setUTCHours(0, 0, 0, 0);
          const endFirstHalf = new Date(year, monthNumber - 1, 15);
          endFirstHalf.setUTCHours(0, 0, 0, 0);
          const startSecondHalf = new Date(year, monthNumber - 1, 16);
          startSecondHalf.setUTCHours(0, 0, 0, 0);
          const endSecondHalf = new Date(year, monthNumber, 0);
          endSecondHalf.setUTCHours(0, 0, 0, 0);
          // Calculo para la quincena anterior
          const month2 = new Date();
          month2.setMonth(now.getMonth() - i - 1);
          const previousMonthNumber = month2.getMonth() + 1;
          const yearForPreviousMonth = month2.getFullYear();
          const startPreviousFirstHalf = new Date(year, monthNumber - 1, 1);
          startPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
          const endPreviousFirstHalf = new Date(year, monthNumber - 1, 15);
          endPreviousFirstHalf.setUTCHours(0, 0, 0, 0);
          const startPreviousSecondHalf = new Date(
            yearForPreviousMonth,
            previousMonthNumber - 1,
            16
          );
          startPreviousSecondHalf.setUTCHours(0, 0, 0, 0);
          const endPreviousSecondHalf = new Date(
            yearForPreviousMonth,
            previousMonthNumber,
            0
          );
          endPreviousSecondHalf.setUTCHours(0, 0, 0, 0);

          previousFirstHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            const receiptDate = new Date(payment.receiptDate);
            return (
              paymentDate >= startPreviousFirstHalf &&
              paymentDate <= endPreviousFirstHalf &&
              receiptDate >= startSecondHalf &&
              receiptDate <= endSecondHalf
            );
          });
          previousSecondHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            const receiptDate = new Date(payment.receiptDate);
            return (
              paymentDate >= startPreviousSecondHalf &&
              paymentDate <= endPreviousSecondHalf &&
              receiptDate >= startFirstHalf &&
              receiptDate <= endFirstHalf
            );
          });
          firstHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            const receiptDate = new Date(payment.receiptDate);
            return (
              (paymentDate >= startFirstHalf && paymentDate <= endFirstHalf) ||
              (receiptDate >= startFirstHalf && receiptDate <= endFirstHalf)
            );
          });
          secondHalfPayments = paymentRecords.filter((payment) => {
            const paymentDate = new Date(payment.paymentDate);
            const receiptDate = new Date(payment.receiptDate);
            return (
              (paymentDate >= startSecondHalf &&
                paymentDate <= endSecondHalf) ||
              (receiptDate >= startSecondHalf && receiptDate <= endSecondHalf)
            );
          });
          clientsForBonus = paymentRecords.filter((payment) => {
            const receiptDate = new Date(payment.receiptDate);
            const plan = payment.plan;
            return (
              receiptDate >= startFirstHalf &&
              receiptDate <= endSecondHalf &&
              plan === "6 dias"
            );
          });
          clientSummary[`${year}-${monthNumber}`] = {
            firstHalf: {
              fortNight: "Primera",
              sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                firstHalfPayments,
                "6",
                endFirstHalf
              ),
              sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                firstHalfPayments,
                "6",
                endFirstHalf
              ),
              threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                firstHalfPayments,
                "3",
                endFirstHalf
              ),
              threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                firstHalfPayments,
                "3",
                endFirstHalf
              ),
              fortNightIncome: calculateFortNightIncome(
                firstHalfPayments,
                startFirstHalf,
                endFirstHalf
              ),
              pendinIncome: calculatePendingIncome(
                firstHalfPayments,
                endFirstHalf
              ),
              incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                previousSecondHalfPayments
              ),
              grossIncome:
                calculateFortNightIncome(
                  firstHalfPayments,
                  startFirstHalf,
                  endFirstHalf
                ) +
                calculateIncomeFromLastFortNight(previousSecondHalfPayments),
              trainerIncome: calculateTrainerIncome(
                firstHalfPayments,
                previousSecondHalfPayments,
                startFirstHalf,
                endFirstHalf
              ),
              monthBonus: calculateBonus(clientsForBonus),
            },
            secondHalf: {
              fortNight: "Segunda",
              sixDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                secondHalfPayments,
                "6",
                endSecondHalf
              ),
              sixDaysPlanTotalPending: calculateXDayPlanTotalPending(
                secondHalfPayments,
                "6",
                endSecondHalf
              ),
              threeDaysPlanTotalPayments: calculateXDayPlanTotalPayments(
                secondHalfPayments,
                "3",
                endSecondHalf
              ),
              threeDaysPlanTotalPending: calculateXDayPlanTotalPending(
                secondHalfPayments,
                "3",
                endSecondHalf
              ),
              fortNightIncome: calculateFortNightIncome(
                secondHalfPayments,
                startSecondHalf,
                endSecondHalf
              ),
              pendinIncome: calculatePendingIncome(
                secondHalfPayments,
                endSecondHalf
              ),
              incomeFromLastFortNight: calculateIncomeFromLastFortNight(
                previousFirstHalfPayments
              ),
              grossIncome:
                calculateFortNightIncome(
                  secondHalfPayments,
                  startSecondHalf,
                  endSecondHalf
                ) + calculateIncomeFromLastFortNight(previousFirstHalfPayments),
              trainerIncome: calculateTrainerIncome(
                secondHalfPayments,
                previousFirstHalfPayments,
                startSecondHalf,
                endSecondHalf
              ),
              monthBonus: calculateBonus(clientsForBonus),
            },
          };
        }

        return this.transformResponse(clientSummary);
      } catch (error) {
        strapi.log.error(error);
        return ctx.internalServerError(
          "Ocurrió un error al procesar la solicitud"
        );
      }
    },
  })
);
