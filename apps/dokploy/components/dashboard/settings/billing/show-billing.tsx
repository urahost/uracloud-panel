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
  CreditCard,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";

console.log('[Stripe Debug] Raw env var:', process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
console.log('[Stripe Debug] Env var length:', process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.length);
console.log('[Stripe Debug] Env var type:', typeof process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);
console.log('[Stripe] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:', process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export const calculatePrice = (count: number, isAnnual = false) => {
  if (isAnnual) {
    if (count <= 1) return 45.9;
    return 35.7 * count;
  }
  if (count <= 1) return 4.5;
  return count * 3.5;
};
export const ShowBilling = () => {
  const { data: servers } = api.server.count.useQuery();
  const { data: admin } = api.user.get.useQuery();
  const { data, isLoading } = api.stripe.getProducts.useQuery();
  const { mutateAsync: createCheckoutSession } =
    api.stripe.createCheckoutSession.useMutation();

  const { mutateAsync: createCustomerPortalSession } =
    api.stripe.createCustomerPortalSession.useMutation();

  // Remplace selectedProductId par selectedPriceId
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  const handleCheckout = async (priceId: string) => {
    console.log('[Billing] handleCheckout called with priceId:', priceId);
    const stripe = await stripePromise;
    if (data && data.subscriptions.length === 0 && priceId) {
      console.log('[Billing] Creating checkout session for priceId:', priceId, 'isAnnual:', isAnnual);
      createCheckoutSession({
        priceId,
        isAnnual,
      }).then(async (session) => {
        console.log('[Billing] Checkout session response:', session);
        await stripe?.redirectToCheckout({
          sessionId: session.sessionId,
        });
      }).catch((err) => {
        console.error('[Billing] Error creating checkout session:', err);
      });
    } else {
      console.log('[Billing] No eligible subscription or priceId missing', { data, priceId });
    }
  };
  // Remplace l'ancien filtrage par défaut
  // const products = data?.products.filter((product) => {
  //   // @ts-ignore
  //   const interval = product?.default_price?.recurring?.interval;
  //   return isAnnual ? interval === "year" : interval === "month";
  // });

  // Nouveau filtrage basé sur les prix
  const products = useMemo(() => {
    if (!data?.products) return [];
    return data.products
      .map((product) => {
        // Cherche le prix correspondant à l'onglet sélectionné
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
      );
  }, [data?.products, isAnnual]);

  const filteredProducts = products;
  const selectedProduct = useMemo(
    () => filteredProducts.find((p) => p.id === selectedPriceId),
    [filteredProducts, selectedPriceId]
  );

  const maxServers = admin?.user.serversQuantity ?? 1;
  const percentage = ((servers ?? 0) / maxServers) * 100;
  const safePercentage = Math.min(percentage, 100);

  return (
    <div className="w-full">
      <Card className="h-full bg-sidebar  p-2.5 rounded-xl  max-w-5xl mx-auto">
        <div className="rounded-xl bg-background shadow-md ">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard className="size-6 text-muted-foreground self-center" />
              <CardTitle className="text-xl">Billing</CardTitle>
            </div>
            {/* Bouton Gérer mon abonnement aligné à droite */}
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
          <CardContent className="space-y-2 py-8 border-t">
            <div className="flex flex-col gap-4 w-full">
              <Tabs
                defaultValue="monthly"
                value={isAnnual ? "annual" : "monthly"}
                className="w-full"
                onValueChange={(e) => setIsAnnual(e === "annual")}
              >
              {
                !admin?.user.hasActiveSubscription && (
                <TabsList>
                    <TabsTrigger value="monthly">Mensuel</TabsTrigger>
                    <TabsTrigger value="annual">Annuel</TabsTrigger>
                </TabsList>
                )
              }
              </Tabs>
              {admin?.user.hasActiveSubscription && (
                <div className="space-y-2 flex flex-col">
                  <h3 className="text-lg font-medium">Votre plan</h3>
                  <div className="flex flex-row gap-2 items-center">
                    <Badge variant="outline">{admin?.user.projectsCount ?? 0} / {admin?.user.projectLimit} projet{(admin?.user.projectLimit ?? 0) > 1 ? 's' : ''}</Badge>
                    <Badge variant="outline">{admin?.user.servicesCount ?? 0} / {admin?.user.serviceLimit} service{(admin?.user.serviceLimit ?? 0) > 1 ? 's' : ''}</Badge>
                  </div>

                  <div className="flex flex-col gap-2 max-w-lg">
                    <span className="text-xs text-muted-foreground">Projets</span>
                    <Progress value={((admin?.user.projectsCount ?? 0) / (admin?.user.projectLimit ?? 1)) * 100} />
                    <span className="text-xs text-muted-foreground mt-2">Services</span>
                    <Progress value={((admin?.user.servicesCount ?? 0) / (admin?.user.serviceLimit ?? 1)) * 100} />
                  </div>
                  {admin && ((admin.user.projectLimit ?? 0) <= (admin.user.projectsCount ?? 0) || (admin.user.serviceLimit ?? 0) <= (admin.user.servicesCount ?? 0)) && (
                    <div className="flex flex-row gap-4 p-2 bg-yellow-50 dark:bg-yellow-950 rounded-lg items-center">
                      <AlertTriangle className="text-yellow-600 dark:text-yellow-400" />
                      <span className="text-sm text-yellow-600 dark:text-yellow-400">
                        Vous avez atteint le nombre maximum de projets ou de services que vous pouvez créer, veuillez mettre à niveau votre plan pour en ajouter plus.
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5 mt-4">
                <span className="text-base text-primary">
                  Besoin d'aide ? Nous sommes là pour vous aider.
                </span>
                <span className="text-sm text-muted-foreground">
                  Rejoignez notre serveur Discord et nous vous aiderons.
                </span>
                <Button className="rounded-full bg-[#5965F2] hover:bg-[#4A55E0] w-fit">
                  <Link
                    href="https://discord.gg/urahost"
                    aria-label="Dokploy on GitHub"
                    target="_blank"
                    className="flex flex-row items-center gap-2 text-white"
                  >
                    <svg
                      role="img"
                      className="h-6 w-6 fill-white"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                    </svg>
                    Join Discord
                  </Link>
                </Button>
              </div>
              {isLoading ? (
                <span className="text-base text-muted-foreground flex flex-row gap-3 items-center justify-center min-h-[10vh]">
                  Loading...
                  <Loader2 className="animate-spin" />
                </span>
              ) : (
                <>
                  {/* Affichage des deux abonnements */}
                  {!admin?.user?.hasActiveSubscription && (
                    <>
                  <div className="flex flex-col md:flex-row gap-6 mt-6">
                    {filteredProducts.map((product) => {
                      const price = product.selected_price;
                      return (
                        <label
                          key={product.id}
                          className={cn(
                            "flex-1 border rounded-2xl p-6 cursor-pointer transition-all flex flex-col gap-2 shadow-sm hover:border-primary",
                            selectedPriceId === price?.id && "border-primary ring-2 ring-primary"
                          )}
                        >
                          <div className="flex items-center gap-3 mb-2">
                            <input
                              type="radio"
                                  name="plan"
                              checked={selectedPriceId === price?.id}
                                  onChange={() => {
                                    setSelectedPriceId(price?.id ?? null);
                                    console.log('[Billing] Offer selected:', price?.id);
                                  }}
                              className="accent-primary"
                            />
                                <span className="font-semibold text-lg">{product.name}</span>
                          </div>
                              <div className="text-sm text-muted-foreground">{product.description}</div>
                              <div className="mt-2 font-bold text-xl">
                                {price?.unit_amount && (price.unit_amount / 100).toLocaleString()} €
                                <span className="text-xs font-normal text-muted-foreground ml-1">
                                  /{isAnnual ? "an" : "mois"}
                              </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                      <div className="flex justify-end mt-4">
                        <Button
                          onClick={() => {
                            console.log('[Billing] S’abonner clicked, selectedPriceId:', selectedPriceId);
                            if (selectedPriceId) handleCheckout(selectedPriceId);
                          }}
                          disabled={!selectedPriceId}
                          className="px-8"
                        >
                          S’abonner
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  );
};
