import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { loadStripe } from "@stripe/stripe-js";
import {
  AlertTriangle,
  CheckIcon,
  CreditCard,
  Loader2,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

export const calculatePrice = (count: number, isAnnual = false) => {
  if (isAnnual) {
    if (count <= 1) return 45.9;
    return 35.7 * count;
  }
  if (count <= 1) return 4.5;
  return count * 3.5;
};

const planFeatures = {
  standard: [
    "5 projets maximum",
    "15 services maximum", 
    "Support par email",
    "Déploiements illimités",
    "SSL automatique",
    "Monitoring basique",
    "Backup automatique"
  ],
  premium: [
    "Projets illimités",
    "Services illimités",
    "Support prioritaire",
    "Déploiements illimités", 
    "SSL automatique",
    "Monitoring avancé",
    "Backup automatique",
    "CI/CD intégré",
    "Analytics détaillées",
    "Support 24/7"
  ]
};

export const ShowBilling = () => {
  const { data: servers } = api.server.count.useQuery();
  const { data: admin } = api.user.get.useQuery();
  const { data, isLoading } = api.stripe.getProducts.useQuery();
  const { mutateAsync: createCheckoutSession } =
    api.stripe.createCheckoutSession.useMutation();

  const { mutateAsync: createCustomerPortalSession } =
    api.stripe.createCustomerPortalSession.useMutation();

  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  const handleCheckout = async (priceId: string) => {
    const stripe = await stripePromise;
    if (data && data.subscriptions.length === 0 && priceId) {
      createCheckoutSession({
        priceId,
        isAnnual,
      }).then(async (session) => {
        await stripe?.redirectToCheckout({
          sessionId: session.sessionId,
        });
      }).catch((err) => {
        console.error('Error creating checkout session:', err);
      });
    }
  };

  const products = useMemo(() => {
    if (!data?.products) return [];
    return data.products
      .map((product) => {
        const price = Array.isArray(product.prices)
          ? product.prices.find(
              (p) =>
                p.active &&
                p.recurring &&
                p.recurring.interval === (isAnnual ? "year" : "month")
            )
          : null;
        return { ...product, selected_price: price };
      })
      .filter(
        (product) =>
          (product.name?.toLowerCase().includes("premium") ||
            product.name?.toLowerCase().includes("standard")) &&
          product.selected_price
      )
      .sort((a, b) => {
        // Standard en premier, Premium en second
        if (a.name?.toLowerCase().includes("standard")) return -1;
        if (b.name?.toLowerCase().includes("standard")) return 1;
        return 0;
      });
  }, [data?.products, isAnnual]);

  const maxServers = admin?.user.serversQuantity ?? 1;
  const percentage = ((servers ?? 0) / maxServers) * 100;
  const safePercentage = Math.min(percentage, 100);

  return (
    <div className="w-full">
      <Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-6xl mx-auto">
        <div className="rounded-xl bg-background shadow-md">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard className="size-6 text-muted-foreground self-center" />
              <CardTitle className="text-xl">Abonnements & Facturation</CardTitle>
            </div>
            {admin?.user?.hasActiveSubscription && (
              <Button
                className="w-fit"
                variant="outline"
                onClick={async () => {
                  const res = await createCustomerPortalSession();
                  if (res?.url) {
                    window.location.href = res.url;
                  }
                }}
              >
                Gérer mon abonnement
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-6 py-8 border-t">
            
            {/* Plan actuel si premium */}
            {admin?.user.hasActiveSubscription && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                  <Star className="size-5 text-yellow-500 fill-yellow-500" />
                  Votre plan Premium
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="text-sm text-green-600 dark:text-green-400 mb-1">Projets</div>
                    <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {admin?.user.projectsCount ?? 0} / {admin?.user.projectLimit === -1 ? '∞' : admin?.user.projectLimit}
                    </div>
                    <Progress 
                      value={admin?.user.projectLimit === -1 ? 0 : ((admin?.user.projectsCount ?? 0) / (admin?.user.projectLimit ?? 1)) * 100} 
                      className="mt-2"
                    />
                  </div>
                  <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">Services</div>
                    <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                      {admin?.user.servicesCount ?? 0} / {admin?.user.serviceLimit === -1 ? '∞' : admin?.user.serviceLimit}
                    </div>
                    <Progress 
                      value={admin?.user.serviceLimit === -1 ? 0 : ((admin?.user.servicesCount ?? 0) / (admin?.user.serviceLimit ?? 1)) * 100} 
                      className="mt-2"
                    />
                  </div>
                  <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-200 dark:border-purple-800">
                    <div className="text-sm text-purple-600 dark:text-purple-400 mb-1">Status</div>
                    <div className="text-2xl font-bold text-purple-700 dark:text-purple-300 flex items-center gap-2">
                      <CheckIcon className="size-6" />
                      Actif
                    </div>
                  </div>
                </div>
                
                {admin && ((admin.user.projectLimit !== -1 && (admin.user.projectLimit ?? 0) <= (admin.user.projectsCount ?? 0)) || 
                          (admin.user.serviceLimit !== -1 && (admin.user.serviceLimit ?? 0) <= (admin.user.servicesCount ?? 0))) && (
                  <div className="flex flex-row gap-4 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg items-center border border-yellow-200 dark:border-yellow-800">
                    <AlertTriangle className="text-yellow-600 dark:text-yellow-400 size-6" />
                    <span className="text-sm text-yellow-600 dark:text-yellow-400">
                      Vous avez atteint le nombre maximum de projets ou de services que vous pouvez créer. 
                      Passez au plan Premium pour débloquer les limites.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Plans disponibles */}
            {!admin?.user?.hasActiveSubscription && (
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-bold">Choisissez votre plan</h2>
                  <p className="text-muted-foreground">Commencez gratuitement, puis évoluez avec vos besoins</p>
                </div>

                <Tabs
                  defaultValue="monthly"
                  value={isAnnual ? "annual" : "monthly"}
                  className="w-full"
                  onValueChange={(e) => setIsAnnual(e === "annual")}
                >
                  <div className="flex justify-center">
                    <TabsList className="grid w-full max-w-md grid-cols-2">
                      <TabsTrigger value="monthly">Mensuel</TabsTrigger>
                      <TabsTrigger value="annual" className="relative">
                        Annuel
                        <Badge variant="secondary" className="ml-2 text-xs">-20%</Badge>
                      </TabsTrigger>
                    </TabsList>
                  </div>
                </Tabs>

                {isLoading ? (
                  <div className="flex items-center justify-center min-h-[40vh]">
                    <div className="text-center space-y-3">
                      <Loader2 className="animate-spin size-8 mx-auto text-primary" />
                      <p className="text-muted-foreground">Chargement des plans...</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
                    {products.map((product) => {
                      const price = product.selected_price;
                      const isStandard = product.name?.toLowerCase().includes("standard");
                      const isPremium = product.name?.toLowerCase().includes("premium");
                      const isSelected = selectedPriceId === price?.id;
                      
                      return (
                        <div
                          key={product.id}
                          className={cn(
                            "relative overflow-hidden rounded-2xl border-2 transition-all duration-300 hover:shadow-lg",
                            isSelected 
                              ? "border-primary shadow-lg shadow-primary/20" 
                              : "border-border hover:border-primary/50",
                            isPremium && "ring-2 ring-primary/20"
                          )}
                        >
                          {isPremium && (
                            <div className="absolute top-0 right-0 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground px-4 py-1 text-sm font-medium rounded-bl-lg">
                              <Sparkles className="inline size-4 mr-1" />
                              Populaire
                            </div>
                          )}
                          
                          <div className="p-8">
                            <div className="text-center space-y-4 mb-6">
                              <div className="space-y-2">
                                <h3 className="text-2xl font-bold flex items-center justify-center gap-2">
                                  {isStandard && <Zap className="size-6 text-blue-500" />}
                                  {isPremium && <Star className="size-6 text-yellow-500" />}
                                  {product.name}
                                </h3>
                                <p className="text-muted-foreground text-sm">{product.description}</p>
                              </div>
                              
                              <div className="space-y-1">
                                <div className="text-4xl font-bold">
                                  {price?.unit_amount && (price.unit_amount / 100).toLocaleString()} €
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  par {isAnnual ? "an" : "mois"}
                                  {isAnnual && isPremium && (
                                    <span className="block text-green-600 font-medium">
                                      Économisez 20% sur l'année
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3 mb-6">
                              {(isStandard ? planFeatures.standard : planFeatures.premium).map((feature, index) => (
                                <div key={index} className="flex items-center gap-3">
                                  <CheckIcon className="size-5 text-green-500 flex-shrink-0" />
                                  <span className="text-sm">{feature}</span>
                                </div>
                              ))}
                            </div>

                            <Button
                              onClick={() => {
                                setSelectedPriceId(price?.id ?? null);
                                if (price?.id) handleCheckout(price.id);
                              }}
                              className={cn(
                                "w-full h-12 font-semibold transition-all",
                                isPremium 
                                  ? "bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary shadow-lg" 
                                  : "bg-primary hover:bg-primary/90"
                              )}
                              size="lg"
                            >
                              {isPremium ? "Choisir Premium" : "Choisir Standard"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Section support */}
            <div className="flex flex-col gap-4 p-6 bg-blue-50 dark:bg-blue-950 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-300">
                  Besoin d'aide ?
                </h3>
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  Notre équipe est là pour vous accompagner dans votre choix et votre migration.
                </p>
              </div>
              <div className="flex justify-center">
                <Button asChild className="bg-[#5965F2] hover:bg-[#4A55E0] text-white">
                  <Link
                    href="https://discord.gg/urahost"
                    target="_blank"
                    className="flex items-center gap-2"
                  >
                    <svg
                      role="img"
                      className="h-5 w-5 fill-white"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                    </svg>
                    Rejoindre Discord
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  );
};