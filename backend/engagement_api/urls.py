from django.urls import path

from . import views

urlpatterns = [
    path('rewards/', views.rewards_collection, name='rewards-collection'),
    path('rewards/<int:pk>/', views.reward_detail, name='reward-detail'),
    path('voucher-claims/', views.voucher_claims_collection, name='voucher-claims-collection'),
    path('voucher-claims/<int:pk>/', views.voucher_claim_detail, name='voucher-claim-detail'),
    path('recognitions/', views.recognitions_collection, name='recognitions-collection'),
    path('recognitions/<int:pk>/', views.recognition_detail, name='recognition-detail'),
    path('events/', views.events_collection, name='events-collection'),
    path('events/<int:pk>/', views.event_detail, name='event-detail'),
    path('clubs/', views.clubs_collection, name='clubs-collection'),
    path('clubs/<int:pk>/', views.club_detail, name='club-detail'),
    path('clubs/<int:club_id>/meetings/', views.club_meetings_collection, name='club-meetings-collection'),
    path('clubs/<int:club_id>/meetings/<int:pk>/', views.club_meeting_detail, name='club-meeting-detail'),
    path('points-rules/', views.points_rules_collection, name='points-rules-collection'),
    path('points-rules/<int:pk>/', views.points_rule_detail, name='points-rule-detail'),
    path('points-rules/<int:rule_id>/grants/', views.points_rule_grants, name='points-rule-grants'),
    # Flash-card deck builder. Static paths precede <int:...> so they aren't shadowed.
    path('flash-cards/training-plan-options/', views.training_plan_options, name='flash-cards-training-plan-options'),
    path('flash-cards/ai/generate/', views.generate_flashcards_view, name='flash-cards-ai-generate'),
    path('flash-cards/decks/', views.flash_card_decks, name='flash-card-decks'),
    path('flash-cards/decks/<int:pk>/', views.flash_card_deck_detail, name='flash-card-deck-detail'),
    path('flash-cards/decks/<int:pk>/cards/', views.flash_card_deck_cards, name='flash-card-deck-cards'),
    path('flash-cards/<int:card_id>/flip/', views.flash_card_flip, name='flash-card-flip'),
]
