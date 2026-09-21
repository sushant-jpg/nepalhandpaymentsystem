import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Loading } from "./components/Ui";
import { useAuth } from "./context/AuthContext";
import { AdminPage } from "./pages/AdminPage";
import { AuditPage } from "./pages/AuditPage";
import { ForgotPasswordPage, LoginPage, RegisterPage } from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { PalmPage } from "./pages/PalmPage";
import { PosPage } from "./pages/PosPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RefundsPage } from "./pages/RefundsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { WalletPage } from "./pages/WalletPage";

function Protected(){const {user,loading}=useAuth();if(loading)return <Loading label="Restoring secure session…"/>;return user?<AppLayout/>:<Navigate to="/login" replace/>}
function RoleRoute({roles,children}:{roles:string[];children:React.ReactNode}){const {user}=useAuth();return user&&roles.includes(user.role)?children:<Navigate to="/app" replace/>}
export default function App(){return <Routes><Route path="/" element={<LandingPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/forgot-password" element={<ForgotPasswordPage/>}/><Route path="/app" element={<Protected/>}><Route index element={<DashboardPage/>}/><Route path="wallet" element={<RoleRoute roles={["CUSTOMER"]}><WalletPage/></RoleRoute>}/><Route path="transactions" element={<TransactionsPage/>}/><Route path="palm" element={<RoleRoute roles={["CUSTOMER"]}><PalmPage/></RoleRoute>}/><Route path="pos" element={<RoleRoute roles={["MERCHANT"]}><PosPage/></RoleRoute>}/><Route path="refunds" element={<RoleRoute roles={["MERCHANT"]}><RefundsPage/></RoleRoute>}/><Route path="security" element={<SecurityPage/>}/><Route path="profile" element={<ProfilePage/>}/><Route path="admin" element={<RoleRoute roles={["ADMIN"]}><AdminPage/></RoleRoute>}/><Route path="audit" element={<RoleRoute roles={["ADMIN","AUDITOR"]}><AuditPage/></RoleRoute>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
