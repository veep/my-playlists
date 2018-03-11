$( document ).ready(function() {
  $(".track-star").click(function() {
    var rating = $(this).data('rating');
    var track_id = $(this).data('trackid');
    if (rating) {
       $.ajax({
         type: "POST",
         url: "/postrating",
         data: { track_id: track_id, rating: rating},
       });
       $(this).parent().children(".track-star").each(function() {
         if ($(this).data('rating') <= rating) {
           $(this).children(".fa-star").addClass("fas").removeClass("far");
         } else {
           $(this).children(".fa-star").addClass("far").removeClass("fas");
         }  
       });
    }                                           
  }); 
}); 