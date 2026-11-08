"use client";

import { createContext, useContext } from "react";
import SearchSelect, { type SearchOption } from "@/components/SearchSelect";

/**
 * The people list for every person picker on a page, sent once. A list of
 * to-dos each with its own edit form would otherwise carry the whole contact
 * list per row.
 */
const PeopleContext = createContext<SearchOption[]>([]);

export function PeopleOptions({ options, children }: { options: SearchOption[]; children: React.ReactNode }) {
  return <PeopleContext.Provider value={options}>{children}</PeopleContext.Provider>;
}

export function PersonSelect({
  name = "person_id",
  defaultValue,
  className,
  ariaLabel = "Person",
}: {
  name?: string;
  defaultValue?: number | string | null;
  className?: string;
  ariaLabel?: string;
}) {
  const options = useContext(PeopleContext);
  return <SearchSelect name={name} options={options} defaultValue={defaultValue} emptyLabel="Nobody" className={className} ariaLabel={ariaLabel} />;
}

/** The companies list for every company picker on a page, sent once (as PeopleOptions does for people). */
const CompanyContext = createContext<SearchOption[]>([]);

export function CompanyOptions({ options, children }: { options: SearchOption[]; children: React.ReactNode }) {
  return <CompanyContext.Provider value={options}>{children}</CompanyContext.Provider>;
}

export function CompanySelect({
  name = "company_id",
  defaultValue,
  className,
  ariaLabel = "Company",
}: {
  name?: string;
  defaultValue?: number | string | null;
  className?: string;
  ariaLabel?: string;
}) {
  const options = useContext(CompanyContext);
  return <SearchSelect name={name} options={options} defaultValue={defaultValue} emptyLabel="No company" className={className} ariaLabel={ariaLabel} />;
}
