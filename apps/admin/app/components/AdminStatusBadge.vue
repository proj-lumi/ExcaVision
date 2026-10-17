<script setup lang="ts">
import {
  ACCOUNT_STATUS_LABELS,
  INVITATION_STATUS_LABELS,
  NODE_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  type AccountStatus,
  type InvitationStatus,
  type NodeStatus,
  type ServiceRequestStatus,
  type UnitStatus,
} from "~/types/mock";

type StatusKind = "account" | "access" | "node" | "request" | "unit";
type StatusValue = AccountStatus | InvitationStatus | NodeStatus | ServiceRequestStatus | UnitStatus;
type BadgeColor = "error" | "neutral" | "primary" | "success" | "warning";

const props = defineProps<{ kind: StatusKind; value: StatusValue }>();

const presentation = computed(() => {
  if (props.kind === "request") {
    const value = props.value as ServiceRequestStatus;
    return {
      label: REQUEST_STATUS_LABELS[value],
      color: ({ open: "primary", completed: "success", spam: "error" } as Record<ServiceRequestStatus, BadgeColor>)[value],
      icon: ({ open: "i-lucide-circle-dot", completed: "i-lucide-circle-check", spam: "i-lucide-shield-alert" } as Record<ServiceRequestStatus, string>)[value],
    };
  }
  if (props.kind === "access") {
    const value = props.value as InvitationStatus;
    return {
      label: INVITATION_STATUS_LABELS[value],
      color: ({ not_invited: "neutral", invited: "primary", activated: "success" } as Record<InvitationStatus, BadgeColor>)[value],
      icon: ({ not_invited: "i-lucide-user-round-x", invited: "i-lucide-mail-check", activated: "i-lucide-badge-check" } as Record<InvitationStatus, string>)[value],
    };
  }
  if (props.kind === "unit") {
    const value = props.value as UnitStatus;
    return {
      label: UNIT_STATUS_LABELS[value],
      color: ({ setup_pending: "warning", active: "success", archived: "neutral" } as Record<UnitStatus, BadgeColor>)[value],
      icon: ({ setup_pending: "i-lucide-clock-3", active: "i-lucide-circle-check", archived: "i-lucide-archive" } as Record<UnitStatus, string>)[value],
    };
  }
  if (props.kind === "node") {
    const value = props.value as NodeStatus;
    return {
      label: NODE_STATUS_LABELS[value],
      color: ({ unassigned: "warning", assigned: "success", archived: "neutral" } as Record<NodeStatus, BadgeColor>)[value],
      icon: ({ unassigned: "i-lucide-circle-dashed", assigned: "i-lucide-circle-check", archived: "i-lucide-archive" } as Record<NodeStatus, string>)[value],
    };
  }
  const value = props.value as AccountStatus;
  return {
    label: ACCOUNT_STATUS_LABELS[value],
    color: ({ pending: "warning", active: "success", disabled: "error" } as Record<AccountStatus, BadgeColor>)[value],
    icon: ({ pending: "i-lucide-clock-3", active: "i-lucide-circle-check", disabled: "i-lucide-circle-x" } as Record<AccountStatus, string>)[value],
  };
});
</script>

<template>
  <UBadge :color="presentation.color" variant="soft" :icon="presentation.icon" class="w-fit gap-1.5">
    {{ presentation.label }}
  </UBadge>
</template>
