import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListFacilities } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Filter, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Facilities() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  
  const { data: facilities, isLoading } = useListFacilities({ activeOnly: true });

  const categories = useMemo(() => {
    if (!facilities) return ["all"];
    const cats = new Set(facilities.map(f => f.category));
    return ["all", ...Array.from(cats)].sort();
  }, [facilities]);

  const filteredFacilities = useMemo(() => {
    if (!facilities) return [];
    
    return facilities.filter(f => {
      const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase()) || 
                            f.category.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedCategory === "all" || f.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [facilities, search, selectedCategory]);

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4">Book a Facility</h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Browse our premium courts and fields. Select a facility to check availability and book your next session.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 mb-10">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input 
            placeholder="Search facilities..." 
            className="pl-10 h-12 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:pb-0 hide-scrollbar">
          <div className="flex gap-2 min-w-max">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                onClick={() => setSelectedCategory(cat)}
                className="capitalize whitespace-nowrap"
              >
                {cat === "all" ? "All Facilities" : cat}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-[250px] w-full rounded-xl" />
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredFacilities.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredFacilities.map((facility) => (
            <Card key={facility.id} className="overflow-hidden group flex flex-col h-full hover:border-primary/50 transition-colors">
              <div className="aspect-[4/3] relative bg-muted overflow-hidden">
                {facility.images && facility.images.length > 0 ? (
                  <img 
                    src={facility.images[0].url} 
                    alt={facility.name} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary">
                    No image available
                  </div>
                )}
                <div className="absolute top-3 left-3 bg-background/90 backdrop-blur px-2.5 py-1 rounded text-xs font-bold shadow-sm uppercase tracking-wider text-primary">
                  {facility.category}
                </div>
              </div>
              <CardContent className="p-6 flex-1 flex flex-col">
                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">{facility.name}</h3>
                {facility.description && (
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">{facility.description}</p>
                )}
                <div className="mt-auto pt-4 border-t flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Price</div>
                    <div className="font-bold text-lg text-foreground">Rp {facility.pricePerHour.toLocaleString('id-ID')}<span className="text-sm font-normal text-muted-foreground">/hr</span></div>
                  </div>
                  <Button asChild>
                    <Link href={`/facilities/${facility.id}`}>Details</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-24 bg-muted/30 rounded-xl border border-dashed">
          <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-xl font-bold mb-2">No facilities found</h3>
          <p className="text-muted-foreground mb-6">We couldn't find any facilities matching your search.</p>
          <Button onClick={() => { setSearch(""); setSelectedCategory("all"); }} variant="outline">
            Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
