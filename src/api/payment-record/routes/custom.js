module.exports = {
  routes: [
    {
      method: "GET",
      path: "/last-three-payments/:clientId",
      handler: "payment-record.lastThree",
    },
    {
      method: "GET",
      path: "/payment-records/trainer/:trainer",
      handler: "payment-record.byTrainer",
    },
    {
      method: "GET",
      path: "/payment-records/summary-count/:trainer/:months",
      handler: "payment-record.getClientCountsByTrainer",
    },
    {
      method: "GET",
      path: "/payment-records/all-summary-count/:months",
      handler: "payment-record.getClientCountsForAllTrainers",
    },
    {
      method: "GET",
      path: "/payment-records/summary-accounts/:trainer/:months",
      handler: "payment-record.getClientAccountsByTrainer",
    },
    {
      method: "GET",
      path: "/payment-records/all-summary-accounts/:months",
      handler: "payment-record.getClientAccountsForAllTrainers",
    },
    {
      method: "GET",
      path: "/payment-records/all-summary/:months",
      handler: "payment-record.getPaymentSummaryForAllTrainers",
    },
  ],
};
