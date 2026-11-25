import { notFound } from "next/navigation";
import { NormalizationError } from "../../../contracts/normalize.ts";
import { appPool } from "../../../db/pool.ts";
import { getTripInvitation } from "../../../trips/service.ts";
import { JoinForm } from "./JoinForm.tsx";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join a trip · GroupRide", referrer: "no-referrer", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  const trip = await getTripInvitation(appPool(), inviteId).catch(error => {
    if (error instanceof NormalizationError) notFound();
    throw error;
  });
  if (!trip) notFound();
  const departure = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(trip.departAt));
  return (
    <main className="page join-page" id="main-content" tabIndex={-1}>
      <header className="page-heading">
        <h1>{trip.name}</h1>
        <p>{trip.destinationLabel} · Departs <time dateTime={trip.departAt}>{departure} UTC</time></p>
      </header>
      <JoinForm inviteId={inviteId.toLowerCase()} mode={trip.locationMode} />
    </main>
  );
}
