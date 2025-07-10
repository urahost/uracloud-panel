import { buffer } from "node:stream/consumers";
import { db } from "@/server/db";
import { organization, server, users_temp } from "@/server/db/schema";
import { type Server, findUserById } from "@dokploy/server";
import { asc, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export const config = {
	api: {
		bodyParser: false,
	},
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	console.log("[Stripe] Webhook endpoint hit", req.method, req.url);
	if (!endpointSecret) {
		return res.status(400).send("Webhook Error: Missing Stripe Secret Key");
	}
	const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
		apiVersion: "2024-09-30.acacia",
		maxNetworkRetries: 3,
	});

	const buf = await buffer(req);
	const sig = req.headers["stripe-signature"] as string;

	let event: Stripe.Event;

	try {
		event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
	} catch (err) {
		console.error(
			"Webhook signature verification failed.",
			err instanceof Error ? err.message : err,
		);
		return res.status(400).send("Webhook Error: ");
	}

	const webhooksAllowed = [
		"customer.subscription.created",
		"customer.subscription.deleted",
		"customer.subscription.updated",
		"invoice.payment_succeeded",
		"invoice.payment_failed",
		"customer.deleted",
		"checkout.session.completed",
	];

	if (!webhooksAllowed.includes(event.type)) {
		return res.status(400).send("Webhook Error: Invalid Event Type");
	}

	switch (event.type) {
		case "checkout.session.completed": {
			const session = event.data.object as Stripe.Checkout.Session;
			const adminId = session?.metadata?.adminId as string;
			console.log("[Stripe] checkout.session.completed", { adminId, customer: session.customer, subscription: session.subscription });
			await db
				.update(users_temp)
				.set({
					stripeCustomerId: session.customer as string,
					stripeSubscriptionId: session.subscription as string,
					subscriptionStatus: "active",
				})
				.where(eq(users_temp.id, adminId));
			break;
		}
		case "customer.subscription.created": {
			const newSubscription = event.data.object as Stripe.Subscription;
			console.log("[Stripe] customer.subscription.created", { customer: newSubscription.customer, status: newSubscription.status });
			await db
				.update(users_temp)
				.set({
					stripeSubscriptionId: newSubscription.id,
					stripeCustomerId: newSubscription.customer as string,
					subscriptionStatus: newSubscription.status,
				})
				.where(eq(users_temp.stripeCustomerId, newSubscription.customer as string));
			break;
		}
		case "customer.subscription.updated": {
			const newSubscription = event.data.object as Stripe.Subscription;
			console.log("[Stripe] customer.subscription.updated", { customer: newSubscription.customer, status: newSubscription.status });
			await db
				.update(users_temp)
				.set({
					subscriptionStatus: newSubscription.status,
				})
				.where(eq(users_temp.stripeCustomerId, newSubscription.customer as string));
			break;
		}
		case "customer.subscription.deleted": {
			const newSubscription = event.data.object as Stripe.Subscription;
			console.log("[Stripe] customer.subscription.deleted", { customer: newSubscription.customer, status: newSubscription.status });
			await db
				.update(users_temp)
				.set({
					stripeSubscriptionId: null,
					subscriptionStatus: "canceled",
				})
				.where(eq(users_temp.stripeCustomerId, newSubscription.customer as string));
			break;
		}
		case "invoice.payment_succeeded": {
			const newInvoice = event.data.object as Stripe.Invoice;
			console.log("[Stripe] invoice.payment_succeeded", { customer: newInvoice.customer, subscription: newInvoice.subscription });
			break;
		}
		case "invoice.payment_failed": {
			const newInvoice = event.data.object as Stripe.Invoice;
			console.log("[Stripe] invoice.payment_failed", { customer: newInvoice.customer, subscription: newInvoice.subscription });
			break;
		}
		case "customer.deleted": {
			const customer = event.data.object as Stripe.Customer;
			console.log("[Stripe] customer.deleted", { customer: customer.id });
			await db
				.update(users_temp)
				.set({
					stripeCustomerId: null,
					stripeSubscriptionId: null,
					subscriptionStatus: null,
				})
				.where(eq(users_temp.stripeCustomerId, customer.id));
			break;
		}
		default:
			console.log(`[Stripe] Unhandled event type: ${event.type}`);
	}

	return res.status(200).json({ received: true });
}

const disableServers = async (userId: string) => {
	const organizations = await db.query.organization.findMany({
		where: eq(organization.ownerId, userId),
	});

	for (const org of organizations) {
		await db
			.update(server)
			.set({
				serverStatus: "inactive",
			})
			.where(eq(server.organizationId, org.id));
	}
};

const findUserByStripeCustomerId = async (stripeCustomerId: string) => {
	const user = db.query.users_temp.findFirst({
		where: eq(users_temp.stripeCustomerId, stripeCustomerId),
	});
	return user;
};

const activateServer = async (serverId: string) => {
	await db
		.update(server)
		.set({ serverStatus: "active" })
		.where(eq(server.serverId, serverId));
};

const deactivateServer = async (serverId: string) => {
	await db
		.update(server)
		.set({ serverStatus: "inactive" })
		.where(eq(server.serverId, serverId));
};

export const findServersByUserIdSorted = async (userId: string) => {
	const organizations = await db.query.organization.findMany({
		where: eq(organization.ownerId, userId),
	});

	const servers: Server[] = [];
	for (const org of organizations) {
		const serversByOrg = await db.query.server.findMany({
			where: eq(server.organizationId, org.id),
			orderBy: asc(server.createdAt),
		});
		servers.push(...serversByOrg);
	}

	return servers;
};
export const updateServersBasedOnQuantity = async (
	userId: string,
	newServersQuantity: number,
) => {
	const servers = await findServersByUserIdSorted(userId);

	if (servers.length > newServersQuantity) {
		for (const [index, server] of servers.entries()) {
			if (index < newServersQuantity) {
				await activateServer(server.serverId);
			} else {
				await deactivateServer(server.serverId);
			}
		}
	} else {
		for (const server of servers) {
			await activateServer(server.serverId);
		}
	}
};
