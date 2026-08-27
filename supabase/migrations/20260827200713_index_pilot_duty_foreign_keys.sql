create index if not exists student_messages_duty_updated_by_idx
on public.student_messages (duty_updated_by);

create index if not exists student_message_duty_actions_actor_user_idx
on public.student_message_duty_actions (actor_user_id);
