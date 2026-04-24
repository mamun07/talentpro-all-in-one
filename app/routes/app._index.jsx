import { data, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer} from "recharts";

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

  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();

  const yesterdayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  ).toISOString();

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const prevSevenDaysAgo = new Date(
    Date.now() - 14 * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    // ── Fetch all orders (last 60 days, no read_all_orders needed) ──
    const [weekRes, prevWeekRes, recentRes] = await Promise.all([
      admin.graphql(`
        query WeekOrders {
          orders(
            first: 250
            query: "created_at:>=${sevenDaysAgo}"
            sortKey: CREATED_AT
            reverse: true
          ) {
            edges {
              node {
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet { shopMoney { amount currencyCode } }
                customer { id firstName lastName }
                lineItems(first: 10) {
                  edges { node { title quantity } }
                }
              }
            }
          }
        }
      `),

      admin.graphql(`
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

      admin.graphql(`
        query RecentOrders {
          orders(first: 5, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                name
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet { shopMoney { amount currencyCode } }
                customer { firstName lastName }
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
    ]);

    const weekResult = await weekRes.json();
    const prevWeekResult = await prevWeekRes.json();
    const recentResult = await recentRes.json();

    // ── Parse data ──
    const weekList = weekResult.data.orders.edges.map((e) => e.node);
    const prevWeekList = prevWeekResult.data.orders.edges.map((e) => e.node);
    const recentOrders = recentResult.data.orders.edges.map((e) => e.node);
    const totalOrdersCount = recentResult.data.ordersCount.count;
    const unfulfilledCount = recentResult.data.unfulfilledCount.count;

    const currency =
      weekList[0]?.totalPriceSet.shopMoney.currencyCode ||
      recentOrders[0]?.totalPriceSet.shopMoney.currencyCode ||
      "USD";

    // ── Today & yesterday from week data ──
    const todayList = weekList.filter(
      (o) => new Date(o.createdAt) >= new Date(todayStart)
    );
    const yesterdayList = weekList.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= new Date(yesterdayStart) && d < new Date(todayStart);
    });

    const todaySales = todayList.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );
    const yesterdaySales = yesterdayList.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );

    const weeklyRevenue = weekList.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );
    const prevWeeklyRevenue = prevWeekList.reduce(
      (sum, o) => sum + parseFloat(o.totalPriceSet.shopMoney.amount),
      0
    );

    // ── % change helper ──
    const pctChange = (current, previous) => {
      if (previous === 0) return current > 0 ? "+100%" : "0%";
      const diff = ((current - previous) / previous) * 100;
      return `${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
    };

    // ── Sales chart by day ──
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const salesByDay = {};
    dayNames.forEach((d) => (salesByDay[d] = 0));
    weekList.forEach((node) => {
      const day = dayNames[new Date(node.createdAt).getDay()];
      salesByDay[day] += parseFloat(node.totalPriceSet.shopMoney.amount);
    });
    const salesData = dayNames.map((day) => ({
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
    const orders = recentOrders.map((node) => ({
      id: node.name,
      customer: node.customer
        ? `${node.customer.firstName || ""} ${
            node.customer.lastName || ""
          }`.trim()
        : "Guest",
      total: `${currency} ${parseFloat(
        node.totalPriceSet.shopMoney.amount
      ).toFixed(2)}`,
      fulfillment: node.displayFulfillmentStatus,
      payment: node.displayFinancialStatus,
      date: new Date(node.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));

    // ── Stats cards ──
    const stats = [
      {
        label: "Today's Sales",
        value: `$${todaySales.toFixed(2)}`,
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
        label: "Total Orders",
        value: totalOrdersCount.toLocaleString(),
        change: "",
        positive: true,
      },
      {
        label: "Weekly Revenue",
        value: `$${weeklyRevenue.toFixed(2)}`,
        change: pctChange(weeklyRevenue, prevWeeklyRevenue),
        positive: weeklyRevenue >= prevWeeklyRevenue,
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
        weeklyRevenue: `$${weeklyRevenue.toFixed(2)}`,
      },
      currency,
      error: null,
    });
  } catch (err) {
    console.error("Dashboard loader error:", err.message);

    return data({
      stats: [
        { label: "Today's Sales", value: "$0.00", change: "0%", positive: true },
        { label: "Today's Orders", value: "0", change: "0%", positive: true },
        { label: "Total Orders", value: "0", change: "", positive: true },
        { label: "Weekly Revenue", value: "$0.00", change: "0%", positive: true },
      ],
      salesData: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
        (day) => ({ day, sales: 0 })
      ),
      recentOrders: [],
      insights: {
        bestSeller: "N/A",
        pendingOrders: 0,
        returningPct: 0,
        weeklyRevenue: "$0.00",
      },
      currency: "USD",
      error: err.message || "Failed to load dashboard data.",
    });
  }
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function Index() {
  const { stats, salesData, recentOrders, insights, error } = useLoaderData();
  const supportUrl = "https://talentpro.global/contact-us/";

  return (
    <s-page heading="TalentPro Dashboard">
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
          <s-banner tone="warning">
            ⚠️ {error}
          </s-banner>
        </s-section>
      )}

      <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
        {/* Stats Cards */}
        {stats.map((stat) => (
          <s-grid-item key={stat.label} gridColumn="span 3">
            <s-section>
              <s-text variant="subdued">{stat.label}</s-text>
              <s-heading level="1">{stat.value}</s-heading>
              {stat.change && (
                <s-text tone={stat.positive ? "success" : "critical"}>
                  {stat.change}
                </s-text>
              )}
            </s-section>
          </s-grid-item>
        ))}

        {/* Sales Chart */}
        <s-grid-item gridColumn="span 8">
          <s-section heading="Sales Overview (Last 7 Days)">
            <div style={{ height: 128, width: "100%" }}>
              <ClientOnly>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesData}>
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value}`, "Sales"]}/>
                    <Line type="monotone" dataKey="sales" stroke="#008060" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }}/>
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
              <s-text>🔥 Best Seller: {insights.bestSeller}</s-text>
              <s-text>📦 Unfulfilled Orders: {insights.pendingOrders}</s-text>
              <s-text>⭐ Returning Customers: {insights.returningPct}%</s-text>
              <s-text>💰 Weekly Revenue: {insights.weeklyRevenue}</s-text>
            </s-stack>
          </s-section>
        </s-grid-item>

        {/* Recent Orders */}
        <s-grid-item gridColumn="span 12">
          <s-section heading="Recent Orders">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">No</s-table-header>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Price</s-table-header>
              </s-table-header-row>

              <s-table-body>
                  {recentOrders.length === 0 ? (
                    <s-text variant="subdued">No orders found.</s-text>
                  ) : (
                    recentOrders.map((order) => (
                      <s-table-row key={order.id}>
                        <s-table-cell>{order.id}</s-table-cell>
                        <s-table-cell>{order.customer}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={order.fulfillment === "unfulfilled" ? "critical" : "success"}>
                            {order.fulfillment === "unfulfilled" ? "Pending" : "Fulfilled"} 
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>{order.total}</s-table-cell>
                      </s-table-row>
                    ))
                  )}
              </s-table-body>
            </s-table>
          </s-section>
        </s-grid-item>


        <s-grid-item gridColumn="span 12">
          <s-section>
            <s-heading level="2">Need help?</s-heading>     
            <s-text variant="subdued">
              Visit our <a href={supportUrl} target="_blank" rel="noopener noreferrer">support center</a> for FAQs, guides, and direct assistance.
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
