import { redirect } from "next/navigation";

// R18 S1: the Supermarket screen arrives in S2. Until then its links (the evening draft push, live adds) open To buy.
export default function SupermarketPage() {
  redirect("/?v=to_buy");
}
