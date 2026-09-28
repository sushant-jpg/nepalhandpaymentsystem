import { useState, type FormEvent } from "react";
import { Building2, CheckCircle2, ClipboardCheck, Save, Send } from "lucide-react";
import { Loading, Notice, PageTitle, Status } from "../components/Ui";
import { useAuth } from "../context/AuthContext";
import { useLoad } from "../hooks/useLoad";
import { api } from "../lib/api";

interface DocumentReference {
  kind: string;
  fileName: string;
  reference: string;
}

interface KycProfile {
  legalFullName?: string;
  dateOfBirth?: string;
  address?: string;
  district?: string;
  phone?: string;
  documentType?: "CITIZENSHIP" | "PASSPORT" | "DRIVING_LICENSE" | "OTHER";
  documentNumber?: string;
  documents: DocumentReference[];
  selfieReference?: string;
  kycStatus: string;
  rejectionReason?: string;
}

interface KybProfile {
  businessName?: string;
  ownerName?: string;
  registrationNumber?: string;
  panNumber?: string;
  category?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  registrationDocuments: DocumentReference[];
  settlementDetails?: {
    bankName?: string;
    accountName?: string;
    maskedAccountNumber?: string;
  };
  approvalStatus: string;
  rejectionReason?: string;
}

export function OnboardingPage() {
  const { user } = useAuth();
  return user?.role === "MERCHANT" ? <MerchantOnboarding /> : <CustomerOnboarding />;
}

function CustomerOnboarding() {
  const { data, error, loading, reload } = useLoad(() => api.get<KycProfile>("/users/kyc"), []);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const documentReference = String(form.get("documentReference") ?? "").trim();
    setBusy(true);
    setActionError("");
    try {
      await api.put("/users/kyc", {
        legalFullName: form.get("legalFullName"),
        dateOfBirth: form.get("dateOfBirth"),
        address: form.get("address"),
        district: form.get("district"),
        phone: form.get("phone"),
        documentType: form.get("documentType"),
        documentNumber: form.get("documentNumber"),
        documents: documentReference
          ? [{ kind: form.get("documentType"), fileName: form.get("documentFileName"), reference: documentReference }]
          : data?.documents,
        selfieReference: form.get("selfieReference") || undefined,
      });
      setMessage("Identity draft saved.");
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "KYC draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setActionError("");
    try {
      await api.post("/users/kyc/submit");
      setMessage("Identity review submitted.");
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "KYC could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label="Loading identity onboarding…" />;
  if (!data) return <Notice>{error || "Identity profile is unavailable."}</Notice>;
  const editable = ["NOT_STARTED", "DRAFT", "REJECTED", "REQUIRES_UPDATE"].includes(data.kycStatus);
  const document = data.documents?.[0];
  return (
    <>
      <PageTitle
        eyebrow="Customer onboarding"
        title="Demo identity verification"
        description="Provide portfolio test data for an administrator to review. Nepal Hand Pay does not validate government documents against an external authority."
        action={<Status value={data.kycStatus} />}
      />
      {(error || actionError) && <div className="mb-5"><Notice>{error || actionError}</Notice></div>}
      {message && <div className="mb-5"><Notice tone="success">{message}</Notice></div>}
      {data.rejectionReason && <div className="mb-5"><Notice>{data.rejectionReason}</Notice></div>}
      <div className="grid gap-6 xl:grid-cols-[1fr_.35fr]">
        <form className="card" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="label sm:col-span-2">Legal full name<input className="input" name="legalFullName" defaultValue={data.legalFullName} required disabled={!editable} /></label>
            <label className="label">Date of birth<input className="input" type="date" name="dateOfBirth" defaultValue={data.dateOfBirth?.slice(0, 10)} required disabled={!editable} /></label>
            <label className="label">Phone<input className="input" name="phone" defaultValue={data.phone} required disabled={!editable} /></label>
            <label className="label">District<input className="input" name="district" defaultValue={data.district} required disabled={!editable} /></label>
            <label className="label sm:col-span-2">Address<input className="input" name="address" defaultValue={data.address} required disabled={!editable} /></label>
            <label className="label">Document type<select className="input" name="documentType" defaultValue={data.documentType || "CITIZENSHIP"} disabled={!editable}><option>CITIZENSHIP</option><option>PASSPORT</option><option>DRIVING_LICENSE</option><option>OTHER</option></select></label>
            <label className="label">Document number<input className="input" name="documentNumber" defaultValue={data.documentNumber} required disabled={!editable} /></label>
            <label className="label">Document file label<input className="input" name="documentFileName" defaultValue={document?.fileName || "identity-document.pdf"} required disabled={!editable} /></label>
            <label className="label">Demo document reference<input className="input" name="documentReference" defaultValue={document?.reference} placeholder="demo://documents/customer-id" required disabled={!editable} /></label>
            <label className="label sm:col-span-2">Selfie reference <span className="font-normal text-slate-400">(optional demo reference)</span><input className="input" name="selfieReference" defaultValue={data.selfieReference} disabled={!editable} /></label>
          </div>
          {editable && <button className="btn-secondary mt-6" disabled={busy}><Save size={17} />{busy ? "Saving…" : "Save draft"}</button>}
        </form>
        <aside className="card h-fit">
          <ClipboardCheck className="text-forest-600" />
          <h2 className="mt-4 text-lg font-bold">Review path</h2>
          <ol className="mt-4 space-y-3 text-sm text-slate-600">
            <li>1. Save complete test details.</li><li>2. Submit for admin review.</li><li>3. Admin approves or requests an update.</li><li>4. Configure PIN and enroll a palm.</li>
          </ol>
          {editable && <button type="button" className="btn-primary mt-6 w-full" disabled={busy || data.kycStatus === "NOT_STARTED"} onClick={() => void submit()}><Send size={17} />Submit for review</button>}
          {data.kycStatus === "APPROVED" && <div className="mt-5 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />Demo identity review approved.</div>}
        </aside>
      </div>
    </>
  );
}

function MerchantOnboarding() {
  const { data, error, loading, reload } = useLoad(() => api.get<KybProfile>("/merchants/onboarding"), []);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reference = String(form.get("documentReference") ?? "").trim();
    setBusy(true);
    setActionError("");
    try {
      await api.put("/merchants/onboarding", {
        businessName: form.get("businessName"), ownerName: form.get("ownerName"),
        registrationNumber: form.get("registrationNumber"), panNumber: form.get("panNumber"),
        category: form.get("category"), address: form.get("address"), contactEmail: form.get("contactEmail"),
        contactPhone: form.get("contactPhone"),
        registrationDocuments: reference ? [{ kind: "BUSINESS_REGISTRATION", fileName: form.get("documentFileName"), reference }] : data?.registrationDocuments,
        settlementDetails: { bankName: form.get("bankName") || undefined, accountName: form.get("accountName") || undefined, maskedAccountNumber: form.get("maskedAccountNumber") || undefined },
      });
      setMessage("Business verification draft saved.");
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "KYB draft could not be saved.");
    } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setActionError("");
    try { await api.post("/merchants/onboarding/submit"); setMessage("Business review submitted."); await reload(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "KYB could not be submitted."); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading label="Loading merchant onboarding…" />;
  if (!data) return <Notice>{error || "Merchant profile is unavailable."}</Notice>;
  const editable = ["DRAFT", "REJECTED"].includes(data.approvalStatus);
  const document = data.registrationDocuments?.[0];
  return <>
    <PageTitle eyebrow="Merchant onboarding" title="Business verification" description="Complete demo KYB details for administrator review. Settlement details are masked references; no bank account is verified or paid." action={<Status value={data.approvalStatus} />} />
    {(error || actionError) && <div className="mb-5"><Notice>{error || actionError}</Notice></div>}{message && <div className="mb-5"><Notice tone="success">{message}</Notice></div>}{data.rejectionReason && <div className="mb-5"><Notice>{data.rejectionReason}</Notice></div>}
    <form className="card" onSubmit={save}><div className="mb-6 flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-forest-50 text-forest-600"><Building2 /></div><div><h2 className="font-bold">Business details</h2><p className="text-xs text-slate-500">Required before accepting demo payments</p></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="label">Business name<input className="input" name="businessName" defaultValue={data.businessName} required disabled={!editable}/></label>
      <label className="label">Owner name<input className="input" name="ownerName" defaultValue={data.ownerName} required disabled={!editable}/></label>
      <label className="label">Category<input className="input" name="category" defaultValue={data.category} required disabled={!editable}/></label>
      <label className="label">Registration number<input className="input" name="registrationNumber" defaultValue={data.registrationNumber} required disabled={!editable}/></label>
      <label className="label">PAN / VAT<input className="input" name="panNumber" defaultValue={data.panNumber} required disabled={!editable}/></label>
      <label className="label">Contact phone<input className="input" name="contactPhone" defaultValue={data.contactPhone} required disabled={!editable}/></label>
      <label className="label">Contact email<input className="input" name="contactEmail" type="email" defaultValue={data.contactEmail} required disabled={!editable}/></label>
      <label className="label sm:col-span-2">Business address<input className="input" name="address" defaultValue={data.address} required disabled={!editable}/></label>
      <label className="label">Document file label<input className="input" name="documentFileName" defaultValue={document?.fileName || "business-registration.pdf"} required disabled={!editable}/></label>
      <label className="label sm:col-span-2">Demo document reference<input className="input" name="documentReference" defaultValue={document?.reference} placeholder="demo://documents/business-registration" required disabled={!editable}/></label>
      <label className="label">Settlement bank <span className="font-normal text-slate-400">(simulated)</span><input className="input" name="bankName" defaultValue={data.settlementDetails?.bankName} disabled={!editable}/></label>
      <label className="label">Account name<input className="input" name="accountName" defaultValue={data.settlementDetails?.accountName} disabled={!editable}/></label>
      <label className="label">Masked account number<input className="input" name="maskedAccountNumber" defaultValue={data.settlementDetails?.maskedAccountNumber} placeholder="**** 1234" disabled={!editable}/></label>
    </div>{editable && <div className="mt-6 flex flex-wrap gap-3"><button className="btn-secondary" disabled={busy}><Save size={17}/>Save draft</button><button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}><Send size={17}/>Submit for review</button></div>}</form>
  </>;
}
