import GatewayApp from "@/app/GatewayApp";

export default function App() {
  // Shared-token login supplies no verified principal/selected image backend.
  // Only a future authenticated server identity response may populate this prop.
  return <GatewayApp imageStudioIdentity={undefined} />;
}
