import { slugify } from "@/lib/slug";
import { db } from "@/server/db";
import {
	apiCreateCompose,
	apiDeleteCompose,
	apiFetchServices,
	apiFindCompose,
	apiRandomizeCompose,
	apiUpdateCompose,
	compose as composeTable,
} from "@/server/db/schema";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { cleanQueuesByCompose, myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";
import { generatePassword } from "@/templates/utils";
import {
	IS_CLOUD,
	addDomainToCompose,
	addNewService,
	checkServiceAccess,
	cloneCompose,
	cloneComposeRemote,
	createCommand,
	createCompose,
	createComposeByTemplate,
	createDomain,
	createMount,
	deleteMount,
	findComposeById,
	findDomainsByComposeId,
	findGitProviderById,
	findProjectById,
	findServerById,
	findUserById,
	getComposeContainer,
	loadServices,
	randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile,
	removeCompose,
	removeComposeDirectory,
	removeDeploymentsByComposeId,
	removeDomainById,
	startCompose,
	stopCompose,
	updateCompose,
} from "@dokploy/server";
import {
	type CompleteTemplate,
	fetchTemplateFiles,
	fetchTemplatesList,
} from "@dokploy/server/templates/github";
import { processTemplate } from "@dokploy/server/templates/processors";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { dump } from "js-yaml";
import _ from "lodash";
import { nanoid } from "nanoid";
import { parse } from "toml";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { projects } from "@/server/db/schema";

export const composeRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateCompose)
		.mutation(async ({ ctx, input }) => {
			try {
				if (ctx.user.role === "member") {
					await checkServiceAccess(
						ctx.user.id,
						input.projectId,
						ctx.session.activeOrganizationId,
						"create",
					);
				}

				if (IS_CLOUD && !input.serverId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You need to use a server to create a compose",
					});
				}
				const project = await findProjectById(input.projectId);
				if (project.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this project",
					});
				}
				if (!ctx.user.enablePaidFeatures) {
					const userProjects = await db.query.projects.findMany({
						where: eq(projects.userId, ctx.user.id),
						with: {
							applications: true,
							mariadb: true,
							mongo: true,
							mysql: true,
							postgres: true,
							redis: true,
							compose: true,
						},
					});
					const totalServices = userProjects.reduce((acc, p) =>
						acc +
							(p.applications?.length || 0) +
							(p.mariadb?.length || 0) +
							(p.mongo?.length || 0) +
							(p.mysql?.length || 0) +
							(p.postgres?.length || 0) +
							(p.redis?.length || 0) +
							(p.compose?.length || 0),
						0,
					);
					if (totalServices >= (ctx.user.serviceLimit ?? 2)) {
						throw new TRPCError({
							code: "FORBIDDEN",
							message: "Limite de services atteinte pour la version gratuite. Passez premium pour créer plus de services.",
						});
					}
				}
				const newService = await createCompose(input);

				if (ctx.user.role === "member") {
					await addNewService(
						ctx.user.id,
						newService.composeId,
						project.organizationId,
					);
				}

				return newService;
			} catch (error) {
				throw error;
			}
		}),

	one: protectedProcedure
		.input(apiFindCompose)
		.query(async ({ input, ctx }) => {
			if (ctx.user.role === "member") {
				await checkServiceAccess(
					ctx.user.id,
					input.composeId,
					ctx.session.activeOrganizationId,
					"access",
				);
			}

			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this compose",
				});
			}

			let hasGitProviderAccess = true;
			let unauthorizedProvider: string | null = null;

			const getGitProviderId = () => {
				switch (compose.sourceType) {
					case "github":
						return compose.github?.gitProviderId;
					case "gitlab":
						return compose.gitlab?.gitProviderId;
					case "bitbucket":
						return compose.bitbucket?.gitProviderId;
					case "gitea":
						return compose.gitea?.gitProviderId;
					default:
						return null;
				}
			};

			const gitProviderId = getGitProviderId();

			if (gitProviderId) {
				try {
					const gitProvider = await findGitProviderById(gitProviderId);
					if (gitProvider.userId !== ctx.session.userId) {
						hasGitProviderAccess = false;
						unauthorizedProvider = compose.sourceType;
					}
				} catch {
					hasGitProviderAccess = false;
					unauthorizedProvider = compose.sourceType;
				}
			}

			return {
				...compose,
				hasGitProviderAccess,
				unauthorizedProvider,
			};
		}),

	update: protectedProcedure
		.input(apiUpdateCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to update this compose",
				});
			}
			return updateCompose(input.composeId, input);
		}),
	delete: protectedProcedure
		.input(apiDeleteCompose)
		.mutation(async ({ input, ctx }) => {
			if (ctx.user.role === "member") {
				await checkServiceAccess(
					ctx.user.id,
					input.composeId,
					ctx.session.activeOrganizationId,
					"delete",
				);
			}
			const composeResult = await findComposeById(input.composeId);

			if (
				composeResult.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to delete this compose",
				});
			}
			4;

			const result = await db
				.delete(composeTable)
				.where(eq(composeTable.composeId, input.composeId))
				.returning();

			const cleanupOperations = [
				async () => await removeCompose(composeResult, input.deleteVolumes),
				async () => await removeDeploymentsByComposeId(composeResult),
				async () => await removeComposeDirectory(composeResult.appName),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return result[0];
		}),
	cleanQueues: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to clean this compose",
				});
			}
			await cleanQueuesByCompose(input.composeId);
		}),

	loadServices: protectedProcedure
		.input(apiFetchServices)
		.query(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to load this compose",
				});
			}
			return await loadServices(input.composeId, input.type);
		}),
	loadMountsByService: protectedProcedure
		.input(
			z.object({
				composeId: z.string().min(1),
				serviceName: z.string().min(1),
			}),
		)
		.query(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to load this compose",
				});
			}
			const container = await getComposeContainer(compose, input.serviceName);
			const mounts = container?.Mounts.filter(
				(mount) => mount.Type === "volume" && mount.Source !== "",
			);
			return mounts;
		}),
	fetchSourceType: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			try {
				const compose = await findComposeById(input.composeId);

				if (
					compose.project.organizationId !== ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to fetch this compose",
					});
				}
				if (compose.serverId) {
					await cloneComposeRemote(compose);
				} else {
					await cloneCompose(compose);
				}
				return compose.sourceType;
			} catch (err) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error fetching source type",
					cause: err,
				});
			}
		}),

	randomizeCompose: protectedProcedure
		.input(apiRandomizeCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to randomize this compose",
				});
			}
			return await randomizeComposeFile(input.composeId, input.suffix);
		}),
	isolatedDeployment: protectedProcedure
		.input(apiRandomizeCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to randomize this compose",
				});
			}
			return await randomizeIsolatedDeploymentComposeFile(
				input.composeId,
				input.suffix,
			);
		}),
	getConvertedCompose: protectedProcedure
		.input(apiFindCompose)
		.query(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to get this compose",
				});
			}
			const domains = await findDomainsByComposeId(input.composeId);
			const composeFile = await addDomainToCompose(compose, domains);
			return dump(composeFile, {
				lineWidth: 1000,
			});
		}),

	deploy: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);

			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to deploy this compose",
				});
			}
			const jobData: DeploymentJob = {
				composeId: input.composeId,
				titleLog: "Manual deployment",
				type: "deploy",
				applicationType: "compose",
				descriptionLog: "",
				server: !!compose.serverId,
			};

			if (IS_CLOUD && compose.serverId) {
				jobData.serverId = compose.serverId;
				await deploy(jobData);
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
		}),
	redeploy: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to redeploy this compose",
				});
			}
			const jobData: DeploymentJob = {
				composeId: input.composeId,
				titleLog: "Rebuild deployment",
				type: "redeploy",
				applicationType: "compose",
				descriptionLog: "",
				server: !!compose.serverId,
			};
			if (IS_CLOUD && compose.serverId) {
				jobData.serverId = compose.serverId;
				await deploy(jobData);
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
		}),
	stop: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to stop this compose",
				});
			}
			await stopCompose(input.composeId);

			return true;
		}),
	start: protectedProcedure
		.input(apiFindCompose)
		.mutation(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to stop this compose",
				});
			}
			await startCompose(input.composeId);

			return true;
		}),
	getDefaultCommand: protectedProcedure
		.input(apiFindCompose)
		.query(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);

			if (compose.project.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to get this compose",
				});
			}
			const command = createCommand(compose);
			return `docker ${command}`;
		},
	),
});