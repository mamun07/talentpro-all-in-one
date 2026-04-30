import { data, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getDateISO(offsetDays = 0) {
  return new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000).toISOString();
}

function sumRevenue(list) {
  return list.reduce(
    (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
    0
  );
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const diff = ((current - previous) / previous) * 100;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
}

function fmt(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

// ─── CLIENT ONLY WRAPPER ──────────────────────────────────────────────────────
function ClientOnly({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return children;
}

// ─── LOADER ───────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const now = new Date();

  const todayStart    = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const yesterdayStart= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
  const sevenDaysAgo  = getDateISO(7);
  const prevSevenDaysAgo = getDateISO(14);
  const thirtyDaysAgo = getDateISO(30);
  const yearStart     = new Date(now.getFullYear(), 0, 1).toISOString();

  try {
    const [weekRes, prevWeekRes, recentRes, monthRes, yearRes] =
      await Promise.all([

        // Last 7 days orders (for chart, today/yesterday, best seller, returning)
        admin.graphql(`#graphql
          query WeekOrders {
            orders(
              first: 250
              query: "created_at:>=${sevenDaysAgo}"
              sortKey: CREATED_AT
              reverse: true
            ) {
              edges {
                node {
                  createdAt
                  totalPriceSet { shopMoney { amount currencyCode } }
                  customer { id }
                  billingAddress {
                    firstName
                    lastName
                  }
                  lineItems(first: 10) {
                    edges { node { title quantity } }
                  }
                }
              }
            }
          }
        `),

        // Previous 7 days (for week-over-week comparison)
        admin.graphql(`#graphql
          query PrevWeekOrders {
            orders(
              first: 250
              query: "created_at:>=${prevSevenDaysAgo} created_at:<${sevenDaysAgo}"
            ) {
              edges {
                node {
                  totalPriceSet { shopMoney { amount } }
                  customer { id }
                }
              }
            }
          }
        `),

        // Recent 5 orders + counts
        admin.graphql(`#graphql
          query RecentOrders {
            orders(first: 5, sortKey: CREATED_AT, reverse: true) {
              edges {
                node {
                  name
                  displayFinancialStatus
                  displayFulfillmentStatus
                  totalPriceSet { shopMoney { amount currencyCode } }
                  customer { id }
                  billingAddress {
                    firstName
                    lastName
                  }
                  createdAt
                }
              }
            }
            ordersCount { count }
            unfulfilledCount: ordersCount(
              query: "fulfillment_status:unfulfilled"
            ) { count }
          }

        `),

        // Last 30 days revenue
        admin.graphql(`#graphql
          query MonthlyOrders {
            orders(
              first: 250
              query: "created_at:>=${thirtyDaysAgo}"
            ) {
              edges {
                node {
                  totalPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        `),

        // This year orders + revenue
        admin.graphql(`#graphql
          query YearlyOrders {
            orders(
              first: 250
              query: "created_at:>=${yearStart}"
            ) {
              edges {
                node {
                  totalPriceSet { shopMoney { amount } }
                }
              }
            }
            ordersCount(query: "created_at:>=${yearStart}") { count }
          }
        `),
      ]);

    // ── Parse responses ──
    const [weekResult, prevWeekResult, recentResult, monthResult, yearResult] =
      await Promise.all([
        weekRes.json(),
        prevWeekRes.json(),
        recentRes.json(),
        monthRes.json(),
        yearRes.json(),
      ]);

    const weekList     = weekResult.data.orders.edges.map((e) => e.node);
    const prevWeekList = prevWeekResult.data.orders.edges.map((e) => e.node);
    const recentOrders = recentResult.data.orders.edges.map((e) => e.node);
    const monthList    = monthResult.data.orders.edges.map((e) => e.node);
    const yearList     = yearResult.data.orders.edges.map((e) => e.node);

    const totalOrdersCount = recentResult.data.ordersCount.count;
    const unfulfilledCount = recentResult.data.unfulfilledCount.count;
    const yearlyOrders     = yearResult.data.ordersCount.count;

    const currency =
      weekList[0]?.totalPriceSet.shopMoney.currencyCode ||
      recentOrders[0]?.totalPriceSet.shopMoney.currencyCode ||
      "USD";

    // ── Today & yesterday ──
    const todayList = weekList.filter(
      (o) => new Date(o.createdAt) >= new Date(todayStart)
    );
    const yesterdayList = weekList.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= new Date(yesterdayStart) && d < new Date(todayStart);
    });

    const todaySales      = sumRevenue(todayList);
    const yesterdaySales  = sumRevenue(yesterdayList);
    const weeklyRevenue   = sumRevenue(weekList);
    const prevWeekRevenue = sumRevenue(prevWeekList);
    const monthlyRevenue  = sumRevenue(monthList);
    const yearlyRevenue   = sumRevenue(yearList);

    // ── Sales chart by day ──
    const salesByDay = Object.fromEntries(DAY_NAMES.map((d) => [d, 0]));
    weekList.forEach((node) => {
      const day = DAY_NAMES[new Date(node.createdAt).getDay()];
      salesByDay[day] += parseFloat(node.totalPriceSet.shopMoney.amount);
    });
    const salesData = DAY_NAMES.map((day) => ({
      day,
      sales: Math.round(salesByDay[day]),
    }));

    // ── Best seller ──
    const productCounts = {};
    weekList.forEach((node) => {
      node.lineItems.edges.forEach(({ node: item }) => {
        productCounts[item.title] =
          (productCounts[item.title] || 0) + item.quantity;
      });
    });
    const bestSeller =
      Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "N/A";

    // ── Returning customers ──
    const thisWeekCustomers = new Set(
      weekList.filter((o) => o.customer?.id).map((o) => o.customer.id)
    );
    const prevWeekCustomers = new Set(
      prevWeekList.filter((o) => o.customer?.id).map((o) => o.customer.id)
    );
    const returningCount = [...thisWeekCustomers].filter((id) =>
      prevWeekCustomers.has(id)
    ).length;
    const returningPct =
      thisWeekCustomers.size > 0
        ? Math.round((returningCount / thisWeekCustomers.size) * 100)
        : 0;

    // ── Format recent orders ──
    const orders = recentOrders.map((node) => {
      const first = node.billingAddress?.firstName || "";
      const last  = node.billingAddress?.lastName  || "";
      const name  = `${first} ${last}`.trim();

      return {
        id: node.name,
        customer: name || "Guest",
        total: fmt(parseFloat(node.totalPriceSet.shopMoney.amount), currency),
        fulfillment: node.displayFulfillmentStatus,
        payment: node.displayFinancialStatus,
        date: new Date(node.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      };
    });


    // ── Stats cards ──
    const stats = [
      {
        label: "Today's Sales",
        value: fmt(todaySales, currency),
        change: pctChange(todaySales, yesterdaySales),
        positive: todaySales >= yesterdaySales,
      },
      {
        label: "Today's Orders",
        value: `${todayList.length}`,
        change: pctChange(todayList.length, yesterdayList.length),
        positive: todayList.length >= yesterdayList.length,
      },
      {
        label: "Weekly Orders",
        value: totalOrdersCount.toLocaleString(),
        change: "100%",
        positive: true,
      },
      {
        label: "Weekly Revenue",
        value: fmt(weeklyRevenue, currency),
        change: pctChange(weeklyRevenue, prevWeekRevenue),
        positive: weeklyRevenue >= prevWeekRevenue,
      },
    ];

    return data({
      stats,
      salesData,
      recentOrders: orders,
      insights: {
        bestSeller,
        pendingOrders: unfulfilledCount,
        returningPct,
        weeklyRevenue: fmt(weeklyRevenue, currency),
        monthlyRevenue: fmt(monthlyRevenue, currency),
        yearlyOrders: yearlyOrders.toLocaleString(),
        yearlyRevenue: fmt(yearlyRevenue, currency),
      },
      currency,
      error: null,
    });
  } catch (err) {
    console.error("Dashboard loader error:", err.message);

    const zeroInsights = {
      bestSeller: "N/A",
      pendingOrders: 0,
      returningPct: 0,
      weeklyRevenue: "$0.00",
      monthlyRevenue: "$0.00",
      yearlyOrders: "0",
      yearlyRevenue: "$0.00",
    };

    return data({
      stats: [
        { label: "Today's Sales",  value: "$0.00", change: "0%", positive: true },
        { label: "Today's Orders", value: "0",     change: "0%", positive: true },
        { label: "Weekly Orders",  value: "0",     change: "",   positive: true },
        { label: "Weekly Revenue", value: "$0.00", change: "0%", positive: true },
      ],
      salesData: DAY_NAMES.map((day) => ({ day, sales: 0 })),
      recentOrders: [],
      insights: zeroInsights,
      currency: "USD",
      error: err.message || "Failed to load dashboard data.",
    });
  }
};

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, change, positive }) {
  return (
    <s-grid-item gridColumn="span 3">
      <s-section>
        <s-text variant="subdued">{label}</s-text>
        <s-heading level="1">{value}</s-heading>
        {change && (
          <s-text tone={positive ? "success" : "critical"}>{change}</s-text>
        )}
      </s-section>
    </s-grid-item>
  );
}

// ─── ORDER ROW ────────────────────────────────────────────────────────────────
function OrderRow({ order }) {
  const isFulfilled = order.fulfillment !== "UNFULFILLED";
  return (
    <s-table-row key={order.id}>
      <s-table-cell>{order.id}</s-table-cell>
      <s-table-cell>{order.customer}</s-table-cell>
      <s-table-cell>
        <s-badge tone={isFulfilled ? "success" : "critical"}>
          {isFulfilled ? "Fulfilled" : "Pending"}
        </s-badge>
      </s-table-cell>
      <s-table-cell>{order.total}</s-table-cell>
    </s-table-row>
  );
}

// ─── UI ───────────────────────────────────────────────────────────────────────
export default function Index() {
  const { stats, salesData, recentOrders, insights, error } = useLoaderData();
  const supportUrl = "https://talentpro.global/contact-us/";

  return (
    <s-page heading="Talentpro">
      {/* Support Button */}
      <s-button
        slot="secondary-actions"
        href={supportUrl}
        target="_blank"
        variant="secondary"
      >
        Get Support
      </s-button>

      {/* Welcome */}
      <s-section>
        <s-heading level="2">Welcome back 👋</s-heading>
        <s-text variant="subdued">
          Here's your live store performance overview.
        </s-text>
      </s-section>

      {/* Error Banner */}
      {error && (
        <s-section>
          <s-banner tone="warning">⚠️ {error}</s-banner>
        </s-section>
      )}

      <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">

        {/* Stats Cards */}
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}

        {/* Sales Chart */}
        <s-grid-item gridColumn="span 8">
          <s-section heading="Sales Overview (Last 7 Days)">
            <div style={{ height: 270, width: "100%" }}>
              <ClientOnly>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesData}>
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value}`, "Sales"]} />
                    <Line
                      type="monotone"
                      dataKey="sales"
                      stroke="#008060"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ClientOnly>
            </div>
          </s-section>
        </s-grid-item>

        {/* Quick Insights */}
        <s-grid-item gridColumn="span 4">
          <s-section heading="Quick Insights">
            <s-stack direction="block" gap="base">
              <s-divider />
              <s-text>🔥 Best Seller: {insights.bestSeller}</s-text>
              <s-text>📦 Unfulfilled Orders: {insights.pendingOrders}</s-text>
              <s-text>⭐ Returning Customers: {insights.returningPct}%</s-text>
              <s-divider />
              <s-text>💰 Weekly Revenue: {insights.weeklyRevenue}</s-text>
              <s-text>💰 Monthly Revenue: {insights.monthlyRevenue}</s-text>
              <s-text>📦 Yearly Orders: {insights.yearlyOrders}</s-text>
              <s-text>💰 Yearly Revenue: {insights.yearlyRevenue}</s-text>
            </s-stack>
          </s-section>
        </s-grid-item>

        {/* Recent Orders */}
        <s-grid-item gridColumn="span 12">
          <s-section heading="Recent Orders">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Price</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {recentOrders.length === 0 ? (
                  <s-text variant="subdued">No orders found.</s-text>
                ) : (
                  recentOrders.map((order) => (
                    <OrderRow key={order.id} order={order} />
                  ))
                )}
              </s-table-body>
            </s-table>
          </s-section>
        </s-grid-item>

        {/* Support Section */}
        <s-grid-item gridColumn="span 12">
          <s-section>
            <s-heading level="2">Need help?</s-heading>
            <s-text variant="subdued">
              Visit our{" "}
              <a href={supportUrl} target="_blank" rel="noopener noreferrer">
                support center
              </a>{" "}
              for FAQs, guides, and direct assistance.
            </s-text>
          </s-section>
        </s-grid-item>

      </s-grid>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
