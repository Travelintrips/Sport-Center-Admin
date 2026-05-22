import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { setToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({
          title: "Login successful",
          description: "Welcome back, Admin.",
        });
        setLocation("/admin");
      },
      onError: (error: any) => {
        toast({
          title: "Login failed",
          description: error?.message || "Invalid credentials",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({
      data: { email, password }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-border">
        <div className="h-2 w-full bg-primary" />
        <CardHeader className="space-y-1 text-center pt-8 pb-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
            <Lock size={32} />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight">Admin Portal</CardTitle>
          <CardDescription>
            Enter your credentials to access the management dashboard
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@sportcenter.com"
                className="h-12"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12"
              />
            </div>
            
            <div className="bg-muted/50 p-4 rounded-md text-sm text-muted-foreground flex flex-col gap-1 border border-border">
              <span className="font-semibold text-foreground">Demo Credentials:</span>
              <span>Email: admin@sportcenter.com</span>
              <span>Password: admin123</span>
            </div>
          </CardContent>
          <CardFooter className="pb-8">
            <Button 
              type="submit" 
              className="w-full h-12 text-base font-bold" 
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Authenticating..." : "Sign In"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
