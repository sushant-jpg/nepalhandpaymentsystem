import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Loading } from "./components/Ui";
import { useAuth } from "./context/AuthContext";

const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })));
const LoginPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("./pages/AuthPages").then((module) => ({ default: module.ForgotPasswordPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const PalmPage = lazy(() => import("./pages/PalmPage").then((module) => ({ default: module.PalmPage })));
const PosPage = lazy(() => import("./pages/PosPage").then((module) => ({ default: module.PosPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const RefundsPage = lazy(() => import("./pages/RefundsPage").then((module) => ({ default: module.RefundsPage })));
const SecurityPage = lazy(() => import("./pages/SecurityPage").then((module) => ({ default: module.SecurityPage })));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage").then((module) => ({ default: module.TransactionsPage })));
const WalletPage = lazy(() => import("./pages/WalletPage").then((module) => ({ default: module.WalletPage })));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Restoring secure session…" />;
  return user ? <AppLayout /> : <Navigate to="/login" replace />;
}

function RoleRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? children : <Navigate to="/app" replace />;
}

export default function App() {
  return <Suspense fallback={<Loading label="Loading workspace…" />}><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/app" element={<Protected />}>
      <Route index element={<DashboardPage />} />
      <Route path="wallet" element={<RoleRoute roles={["CUSTOMER"]}><WalletPage /></RoleRoute>} />
      <Route path="transactions" element={<TransactionsPage />} />
      <Route path="palm" element={<RoleRoute roles={["CUSTOMER"]}><PalmPage /></RoleRoute>} />
      <Route path="pos" element={<RoleRoute roles={["MERCHANT"]}><PosPage /></RoleRoute>} />
      <Route path="refunds" element={<RoleRoute roles={["MERCHANT"]}><RefundsPage /></RoleRoute>} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="admin" element={<RoleRoute roles={["ADMIN"]}><AdminPage /></RoleRoute>} />
      <Route path="audit" element={<RoleRoute roles={["ADMIN", "AUDITOR"]}><AuditPage /></RoleRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
