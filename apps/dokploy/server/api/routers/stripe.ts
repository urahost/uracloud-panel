import { WEBSITE_URL, getStripeItems } from "@/server/utils/stripe";
import {
	IS_CLOUD,
	findServersByUserId,
	findUserById,
	updateUser,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const stripeRouter = createTRPCRouter({
	getProducts: publicProcedure.query(async ({ ctx }) => {
		if (!ctx.user) {
			throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
		}
		const user = await findUserById(ctx.user.ownerId);
		const stripeCustomerId = user.stripeCustomerId;

		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
			apiVersion: "2024-09-30.acacia",
		});

		const products = await stripe.products.list({
			expand: ["data.default_price"],
			active: true,
		});

		// Pour chaque produit, on récupère tous les prix associés (mensuel, annuel, etc.)
		const productsWithPrices = await Promise.all(
			products.data.map(async (product) => {
				const prices = await stripe.prices.list({
					product: product.id,
					active: true,
				});
				return {
					...product,
					prices: prices.data,
				};
			})
		);

		if (!stripeCustomerId) {
			return {
				products: productsWithPrices,
				subscriptions: [],
			};
		}

		const subscriptions = await stripe.subscriptions.list({
			customer: stripeCustomerId,
			status: "active",
			expand: ["data.items.data.price"],
		});

		// Ne garder que les subscriptions vraiment actives (pas en cours d'annulation)
		const activeSubscriptions = subscriptions.data.filter(
			(sub) => sub.status === "active" && sub.cancel_at_period_end === false
		);

		return {
			products: productsWithPrices,
			subscriptions: activeSubscriptions,
		};
	}),
	createCheckoutSession: publicProcedure
		.input(
			z.object({
				priceId: z.string(),
				isAnnual: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!ctx.user) {
				throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
			}
			const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
				apiVersion: "2024-09-30.acacia",
			});

			const items = [
				{
					price: input.priceId,
					quantity: 1,
				},
			];
			const user = await findUserById(ctx.user.id);

			let stripeCustomerId = user.stripeCustomerId;

			if (stripeCustomerId) {
				const customer = await stripe.customers.retrieve(stripeCustomerId);

				if (customer.deleted) {
					await updateUser(user.id, {
						stripeCustomerId: null,
					});
					stripeCustomerId = null;
				}
			}

			// Ajout : Crée un Stripe Customer si l'utilisateur n'en a pas
			if (!stripeCustomerId) {
				const customer = await stripe.customers.create({
					email: user.email,
					name: user.name, // si ce champ existe
					metadata: { userId: user.id },
				});
				stripeCustomerId = customer.id;
				await updateUser(user.id, { stripeCustomerId });
			}

			const session = await stripe.checkout.sessions.create({
				mode: "subscription",
				line_items: items,
				...(stripeCustomerId && {
					customer: stripeCustomerId,
				}),
				metadata: {
					adminId: user.id,
				},
				allow_promotion_codes: true,
				success_url: `${WEBSITE_URL}/dashboard/settings/profile?success=true`,
				cancel_url: `${WEBSITE_URL}/dashboard/settings/billing`,
			});

			return { sessionId: session.id };
		}),
	createCustomerPortalSession: publicProcedure.mutation(async ({ ctx }) => {
		if (!ctx.user) {
			throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
		}
		const user = await findUserById(ctx.user.id);

		if (!user.stripeCustomerId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Stripe Customer ID not found",
			});
		}
		const stripeCustomerId = user.stripeCustomerId;

		const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
			apiVersion: "2024-09-30.acacia",
		});

		try {
			const session = await stripe.billingPortal.sessions.create({
				customer: stripeCustomerId,
				return_url: `${WEBSITE_URL}/dashboard/settings/billing`,
			});

			return { url: session.url };
		} catch (_) {
			return {
				url: "",
			};
		}
	}),

	canCreateMoreServers: publicProcedure.query(async ({ ctx }) => {
		if (!ctx.user) {
			throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
		}
		const user = await findUserById(ctx.user.ownerId);
		const servers = await findServersByUserId(user.id);

		if (!IS_CLOUD) {
			return true;
		}

		return servers.length < user.serversQuantity;
	}),
});
