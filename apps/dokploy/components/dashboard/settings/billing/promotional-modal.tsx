import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { 
  Gift, 
  Star, 
  Check, 
  Copy,
  Sparkles,
  Zap
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

interface PromotionalModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PromotionalModal = ({ isOpen, onClose }: PromotionalModalProps) => {
  const [copied, setCopied] = useState(false);
  const promoCode = "UPGRADE10";

  const copyPromoCode = () => {
    navigator.clipboard.writeText(promoCode);
    setCopied(true);
    toast.success("Code promo copié !");
    setTimeout(() => setCopied(false), 2000);
  };

  const premiumFeatures = [
    "Services illimités",
    "Projets illimités", 
    "Support prioritaire",
    "Analytics avancées",
    "CI/CD intégré",
    "Backup automatique"
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden">
        {/* Header avec gradient */}
        <div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-primary-foreground">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-white/20 rounded-lg">
              <Gift className="size-6" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-white">
                Limite atteinte !
              </DialogTitle>
              <DialogDescription className="text-primary-foreground/80">
                Débloquez tout votre potentiel avec -10%
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Contenu */}
        <div className="p-6 space-y-6">
          {/* Message principal */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full text-sm font-medium">
              <Zap className="size-4" />
              Vous avez atteint la limite de services
            </div>
            <p className="text-muted-foreground text-sm">
              Continuez à développer vos projets sans contraintes
            </p>
          </div>

          {/* Code promo */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border border-green-200 dark:border-green-800 rounded-xl p-4">
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center gap-2">
                <Sparkles className="size-5 text-green-600" />
                <span className="font-semibold text-green-700 dark:text-green-300">
                  Offre spéciale limitée
                </span>
              </div>
              
              <div className="space-y-2">
                <Badge variant="outline" className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700 text-lg px-4 py-2 font-mono">
                  {promoCode}
                </Badge>
                <p className="text-green-600 dark:text-green-400 text-sm font-medium">
                  10% de réduction sur votre premier mois
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={copyPromoCode}
                className="bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800"
              >
                {copied ? (
                  <>
                    <Check className="size-4 mr-2" />
                    Copié !
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-2" />
                    Copier le code
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Avantages Premium */}
          <div className="space-y-3">
            <h4 className="font-semibold text-center flex items-center justify-center gap-2">
              <Star className="size-5 text-yellow-500" />
              Ce que vous débloquez avec Premium
            </h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {premiumFeatures.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Check className="size-4 text-green-500 flex-shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="p-6 pt-0 flex-col sm:flex-col space-y-2">
          <Button asChild className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary">
            <Link href="/dashboard/settings/billing" onClick={onClose}>
              <Star className="size-4 mr-2" />
              Passer à Premium maintenant
            </Link>
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full">
            Plus tard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};